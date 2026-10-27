import type pg from 'pg';
import type { DecisionInput } from '../../core/index.ts';
import type { Scenario, ScenarioId } from '../../modules/scenarios/domain/scenario.ts';
import type { ScenarioRepository } from '../../modules/scenarios/ports/scenario-ports.ts';
import type { HouseholdId, UserId } from '../../modules/shared/actor.ts';
import type { TransactionRunner, WriteContext } from '../../modules/shared/ports.ts';
import type { PlanCapabilities, PlanReader } from '../../modules/subscription/ports/subscription-ports.ts';
import { clientOf } from './pg-transaction-runner.ts';

interface ScenarioRow {
  id: string;
  owner_id: string;
  name: string;
  base_kind: 'personal' | 'household';
  household_id: string | null;
  decisions: DecisionInput[];
}

const toScenario = (row: ScenarioRow): Scenario => ({
  id: row.id as ScenarioId,
  ownerId: row.owner_id as UserId,
  name: row.name,
  base: row.base_kind === 'household' && row.household_id !== null ? { kind: 'household', householdId: row.household_id as HouseholdId } : { kind: 'personal' },
  decisions: row.decisions,
});

async function audit(client: pg.PoolClient, context: WriteContext, action: string, targetId: string) {
  await client.query(
    `INSERT INTO app.audit_log (actor_type, actor_id, action, target_type, target_id, origin_ip, occurred_at, prev_hash, hash, seq)
     VALUES ('user', $1, $2, 'scenario', $3, $4::inet, now(), '\\x00', '\\x00', 0)`,
    [context.actor.userId, action, targetId, context.ip],
  );
}

/**
 * Scenarios (migration 0006). Creation goes through create_scenario_if_under_limit, which reads
 * the plan in force and serializes concurrent requests, so the Tabla 13 limit always holds.
 */
export function createPgScenarioStore(runner: TransactionRunner): ScenarioRepository {
  const columns = 'id, owner_id, name, base_kind, household_id, decisions';
  return {
    async listForActor(actor) {
      return runner.withActor(actor, async (tx) => {
        const { rows } = await clientOf(tx).query<ScenarioRow>(`SELECT ${columns} FROM app.scenarios WHERE owner_id = $1 ORDER BY created_at, id`, [actor.userId]);
        return rows.map(toScenario);
      });
    },
    async findForActor(actor, id) {
      return runner.withActor(actor, async (tx) => {
        const { rows } = await clientOf(tx).query<ScenarioRow>(`SELECT ${columns} FROM app.scenarios WHERE id = $1`, [id]);
        const row = rows[0];
        return row === undefined ? null : toScenario(row);
      });
    },
    async createIfUnderLimit(context, draft) {
      return runner.withActor(context.actor, async (tx) => {
        const client = clientOf(tx);
        const householdId = draft.base.kind === 'household' ? draft.base.householdId : null;
        const { rows } = await client.query<{ result: 'created' | 'limit_reached' }>(
          'SELECT app.create_scenario_if_under_limit($1, $2, $3, $4, $5::jsonb) AS result',
          [draft.id, draft.name, draft.base.kind, householdId, JSON.stringify(draft.decisions)],
        );
        const result = rows[0]?.result ?? 'limit_reached';
        if (result === 'created') await audit(client, context, 'scenario.created', draft.id);
        return result;
      });
    },
    async updateForActor(context, draft) {
      return runner.withActor(context.actor, async (tx) => {
        const client = clientOf(tx);
        const householdId = draft.base.kind === 'household' ? draft.base.householdId : null;
        const { rowCount } = await client.query(
          'UPDATE app.scenarios SET name = $2, base_kind = $3, household_id = $4, decisions = $5::jsonb, updated_at = now() WHERE id = $1',
          [draft.id, draft.name, draft.base.kind, householdId, JSON.stringify(draft.decisions)],
        );
        if (rowCount === 0) return false;
        await audit(client, context, 'scenario.updated', draft.id);
        return true;
      });
    },
    async deleteForActor(context, id) {
      return runner.withActor(context.actor, async (tx) => {
        const client = clientOf(tx);
        const { rowCount } = await client.query('DELETE FROM app.scenarios WHERE id = $1', [id]);
        if (rowCount === 0) return false;
        await audit(client, context, 'scenario.deleted', id);
        return true;
      });
    },
  };
}

/**
 * Plan in force today in Chile, as app.effective_plan does: the paid plan while its period
 * lasts, otherwise the free plan (HU20). Subscriptions are filtered by RLS to the actor.
 */
export function createPgPlanReader(runner: TransactionRunner): PlanReader {
  return {
    async capabilitiesFor(actor) {
      return runner.withActor(actor, async (tx) => {
        const { rows } = await clientOf(tx).query<{
          code: PlanCapabilities['code'];
          name: string;
          max_saved_scenarios: number | null;
          max_compared_scenarios: number;
          user_prepayments: boolean;
          household_space: boolean;
        }>(
          `SELECT p.code, p.name, p.max_saved_scenarios, p.max_compared_scenarios, p.user_prepayments, p.household_space
             FROM app.plans p
            WHERE p.code = coalesce(
              (SELECT s.plan_code FROM app.subscriptions s
                WHERE s.user_id = $1
                  AND s.period_start <= (now() AT TIME ZONE 'America/Santiago')::date
                  AND s.period_end > (now() AT TIME ZONE 'America/Santiago')::date),
              'free')`,
          [actor.userId],
        );
        const row = rows[0];
        if (row === undefined) throw new Error('The plans table has no free plan');
        return {
          code: row.code,
          name: row.name,
          maxSavedScenarios: row.max_saved_scenarios,
          maxComparedScenarios: row.max_compared_scenarios,
          userPrepayments: row.user_prepayments,
          householdSpace: row.household_space,
        };
      });
    },
  };
}
