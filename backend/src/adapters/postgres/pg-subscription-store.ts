import type pg from 'pg';
import { clp } from '../../core/index.ts';
import type { UserId } from '../../modules/shared/actor.ts';
import type { TransactionRunner, WriteContext } from '../../modules/shared/ports.ts';
import type { OrderStatus, PaymentOrderSummary, PlanCode, PlanOffer, SubscriptionPeriod } from '../../modules/subscription/domain/subscription.ts';
import type { PaymentSettlement, SettlementResult, SubscriptionCanceller, SubscriptionStore } from '../../modules/subscription/ports/subscription-ports.ts';
import { clientOf } from './pg-transaction-runner.ts';

type PaidPlan = Exclude<PlanCode, 'free'>;

async function audit(client: pg.PoolClient, actorType: 'user' | 'system', actorId: string, ip: string | null, action: string, details: Record<string, string> = {}) {
  // Identifiers only: never the amount or the token (HU25).
  await client.query(
    `INSERT INTO app.audit_log (actor_type, actor_id, action, target_type, target_id, origin_ip, details, occurred_at, prev_hash, hash, seq)
     VALUES ($1, $2, $3, 'subscription', $2, $4::inet, $5::jsonb, now(), '\\x00', '\\x00', 0)`,
    [actorType, actorId, action, ip, JSON.stringify(details)],
  );
}

/**
 * Plans, orders and subscriptions in PostgreSQL (migrations 0005 and 0013). Subscriptions change
 * only through settle_payment_order and cancel_subscription; the API role cannot write them.
 */
export function createPgSubscriptionStore(runner: TransactionRunner): SubscriptionStore & PaymentSettlement & SubscriptionCanceller {
  return {
    async listPlans() {
      return runner.withActor(null, async (tx) => {
        const { rows } = await clientOf(tx).query<{
          code: PlanCode;
          name: string;
          price_clp: string | null;
          period_months: number;
          max_saved_scenarios: number | null;
          max_compared_scenarios: number;
          full_history: boolean;
          user_prepayments: boolean;
          household_space: boolean;
        }>(`SELECT * FROM app.plans ORDER BY CASE code WHEN 'free' THEN 0 WHEN 'paid' THEN 1 ELSE 2 END`);
        return rows.map(
          (row): PlanOffer => ({
            code: row.code,
            name: row.name,
            priceClp: row.code === 'free' || row.price_clp === null ? null : Number(row.price_clp),
            periodMonths: row.period_months,
            maxSavedScenarios: row.max_saved_scenarios,
            maxComparedScenarios: row.max_compared_scenarios,
            fullHistory: row.full_history,
            userPrepayments: row.user_prepayments,
            householdSpace: row.household_space,
          }),
        );
      });
    },

    async currentPeriod(actor) {
      return runner.withActor(actor, async (tx) => {
        const { rows } = await clientOf(tx).query<{ plan_code: PaidPlan; period_start: string; period_end: string; cancel_at_period_end: boolean; updated_at: Date }>(
          `SELECT plan_code, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end, cancel_at_period_end, updated_at
             FROM app.subscriptions WHERE user_id = $1`,
          [actor.userId],
        );
        const row = rows[0];
        return row === undefined
          ? null
          : ({ planCode: row.plan_code, periodStart: row.period_start, periodEnd: row.period_end, cancelAtPeriodEnd: row.cancel_at_period_end, updatedAt: row.updated_at } satisfies SubscriptionPeriod);
      });
    },

    async latestOrder(actor) {
      return runner.withActor(actor, async (tx) => {
        const { rows } = await clientOf(tx).query<{ buy_order: string; plan_code: PaidPlan; amount: string; status: OrderStatus; created_at: Date; committed_at: Date | null }>(
          `SELECT buy_order, plan_code, amount, status, created_at, committed_at FROM app.payment_orders
            WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [actor.userId],
        );
        const row = rows[0];
        return row === undefined
          ? null
          : ({ buyOrder: row.buy_order, planCode: row.plan_code, amount: Number(row.amount), status: row.status, createdAt: row.created_at, committedAt: row.committed_at } satisfies PaymentOrderSummary);
      });
    },

    async todayInChile() {
      return runner.withActor(null, async (tx) => {
        const { rows } = await clientOf(tx).query<{ today: string }>(`SELECT to_char((now() AT TIME ZONE 'America/Santiago')::date, 'YYYY-MM-DD') AS today`);
        return rows[0]?.today ?? '';
      });
    },

    async createOrder(context: WriteContext, buyOrder, planCode) {
      return runner.withActor(context.actor, async (tx) => {
        const client = clientOf(tx);
        // The RLS policy also checks the amount against the plan's current price.
        const { rows } = await client.query<{ amount: string }>(
          `INSERT INTO app.payment_orders (buy_order, user_id, plan_code, amount)
           SELECT $1, $2, p.code, p.price_clp FROM app.plans p WHERE p.code = $3 AND p.price_clp IS NOT NULL
           RETURNING amount`,
          [buyOrder, context.actor.userId, planCode],
        );
        const row = rows[0];
        if (row === undefined) return null;
        await audit(client, 'user', context.actor.userId, context.ip, 'subscription.payment_started', { buy_order: buyOrder, plan: planCode });
        return { amount: clp(Number(row.amount)) };
      });
    },

    async attachProviderToken(context, buyOrder, token) {
      await runner.withActor(context.actor, async (tx) => {
        await clientOf(tx).query('UPDATE app.payment_orders SET provider_token = $2 WHERE buy_order = $1', [buyOrder, token]);
      });
    },

    async findOrderByToken(token) {
      return runner.withActor(null, async (tx) => {
        const { rows } = await clientOf(tx).query<{ buy_order: string; user_id: string | null; status: string }>(
          'SELECT buy_order, user_id, status FROM app.find_payment_order_by_token($1)',
          [token],
        );
        const row = rows[0];
        const userId = row?.user_id ?? null;
        if (row === undefined || userId === null) return null;
        return { buyOrder: row.buy_order, userId: userId as UserId, status: row.status };
      });
    },

    async settle(userId, buyOrder, outcome): Promise<SettlementResult> {
      return runner.withActor(null, async (tx) => {
        const client = clientOf(tx);
        const { rows } = await client.query<{ result: SettlementResult }>('SELECT app.settle_payment_order($1, $2, $3, $4, $5) AS result', [
          buyOrder,
          userId,
          outcome.status,
          outcome.status === 'authorized' ? outcome.amount : null,
          outcome.responseCode,
        ]);
        const result = rows[0]?.result ?? 'unknown_order';
        if (result !== 'unknown_order') await audit(client, 'system', userId, null, `subscription.payment_${result}`, { buy_order: buyOrder });
        return result;
      });
    },

    async cancelRenewal(userId) {
      return runner.withActor({ userId }, async (tx) => {
        const client = clientOf(tx);
        const { rows } = await client.query<{ cancelled: boolean | null }>('SELECT app.cancel_subscription() AS cancelled');
        const cancelled = rows[0]?.cancelled === true;
        if (cancelled) await audit(client, 'user', userId, null, 'subscription.renewal_cancelled');
        return cancelled;
      });
    },
  };
}
