import type pg from 'pg';
import type { AccountSummary, AdminContext, AdminDirectory, AuditEntryView, PaymentOrderView } from '../../modules/administration/ports/administration-ports.ts';
import type { UserId } from '../../modules/shared/actor.ts';
import type { TransactionRunner } from '../../modules/shared/ports.ts';
import { clientOf } from './pg-transaction-runner.ts';

const CHILE_TODAY = `(now() AT TIME ZONE 'America/Santiago')::date`;
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

async function audit(client: pg.PoolClient, admin: AdminContext, action: string, targetType: string, targetId: string | null) {
  // The admin role may only record admin or system actions (migration 0008).
  await client.query(
    `INSERT INTO app.audit_log (actor_type, actor_id, action, target_type, target_id, origin_ip, occurred_at, prev_hash, hash, seq)
     VALUES ('admin', $1, $2, $3, $4, $5::inet, now(), '\\x00', '\\x00', 0)`,
    [admin.adminId, action, targetType, targetId, admin.ip],
  );
}

/**
 * Admin API data access with the app_admin login role (migrations 0002, 0005, 0008, 0009). That
 * role has no grant on incomes, expenses, debts, scenarios, households or bank data (HU23).
 */
export function createPgAdminDirectory(runner: TransactionRunner): AdminDirectory {
  const read = <T>(work: (client: pg.PoolClient) => Promise<T>) => runner.withActor(null, (tx) => work(clientOf(tx)));

  return {
    async lookupLogin(email) {
      return read(async (client) => {
        const { rows } = await client.query<{
          user_id: string;
          password_hash: string;
          status: 'active' | 'suspended';
          totp_secret_ciphertext: Buffer;
          totp_nonce: Buffer;
          totp_key_version: number;
        }>('SELECT * FROM app.lookup_admin_login($1)', [email]);
        const row = rows[0];
        return row === undefined
          ? null
          : {
              userId: row.user_id as UserId,
              passwordHash: row.password_hash,
              status: row.status,
              totp: { ciphertext: new Uint8Array(row.totp_secret_ciphertext), nonce: new Uint8Array(row.totp_nonce), keyVersion: row.totp_key_version },
            };
      });
    },

    async isActiveAdmin(userId) {
      return read(async (client) => {
        const { rows } = await client.query(
          `SELECT 1 FROM app.platform_admins a JOIN app.users u ON u.id = a.user_id WHERE a.user_id = $1 AND u.status = 'active'`,
          [userId],
        );
        return rows.length > 0;
      });
    },

    async searchAccounts(query, limit) {
      return read(async (client) => {
        const { rows } = await client.query<{
          id: string;
          email: string;
          status: 'active' | 'suspended';
          verified: boolean;
          created_at: Date;
          plan_code: AccountSummary['planCode'] | null;
          period_end: string | null;
          cancel_at_period_end: boolean | null;
        }>(
          `SELECT u.id, u.email, u.status, u.email_verified_at IS NOT NULL AS verified, u.created_at,
                  s.plan_code, to_char(s.period_end, 'YYYY-MM-DD') AS period_end, s.cancel_at_period_end
             FROM app.users u
             LEFT JOIN app.subscriptions s ON s.user_id = u.id AND s.period_start <= ${CHILE_TODAY} AND s.period_end > ${CHILE_TODAY}
            WHERE u.email LIKE '%' || $1 || '%' ESCAPE '\\'
            ORDER BY u.created_at DESC LIMIT $2`,
          [escapeLike(query), limit],
        );
        return rows.map(
          (row): AccountSummary => ({
            id: row.id,
            email: row.email,
            status: row.status,
            emailVerified: row.verified,
            createdAt: row.created_at,
            planCode: row.plan_code ?? 'free',
            periodEnd: row.period_end,
            cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
          }),
        );
      });
    },

    async setAccountStatus(admin, userId, status) {
      return read(async (client) => {
        const { rowCount } = await client.query('UPDATE app.users SET status = $2, updated_at = now() WHERE id = $1', [userId, status]);
        if (rowCount === 0) return false;
        await audit(client, admin, status === 'suspended' ? 'admin.account_suspended' : 'admin.account_reactivated', 'user', userId);
        return true;
      });
    },

    async auditEntries(filter) {
      return read(async (client) => {
        const { rows } = await client.query<{
          seq: string;
          occurred_at: Date;
          actor_type: AuditEntryView['actorType'];
          actor_id: string | null;
          action: string;
          target_type: string;
          target_id: string | null;
          origin_ip: string | null;
        }>(
          `SELECT seq, occurred_at, actor_type, actor_id, action, target_type, target_id, host(origin_ip) AS origin_ip
             FROM app.audit_log
            WHERE ($1::bigint IS NULL OR seq < $1) AND ($2::uuid IS NULL OR actor_id = $2) AND ($3::text IS NULL OR action LIKE $3 || '%')
            ORDER BY seq DESC LIMIT $4`,
          [filter.beforeSeq ?? null, filter.actorId ?? null, filter.actionPrefix ?? null, filter.limit],
        );
        return rows.map(
          (row): AuditEntryView => ({
            seq: Number(row.seq),
            occurredAt: row.occurred_at,
            actorType: row.actor_type,
            actorId: row.actor_id,
            action: row.action,
            targetType: row.target_type,
            targetId: row.target_id,
            originIp: row.origin_ip,
          }),
        );
      });
    },

    async verifyAuditChain() {
      return read(async (client) => {
        const { rows } = await client.query<{ broken: string | null }>('SELECT app.verify_audit_chain() AS broken');
        const broken = rows[0]?.broken ?? null;
        return broken === null ? null : Number(broken);
      });
    },

    async paymentOrders(filter) {
      return read(async (client) => {
        const { rows } = await client.query<{
          buy_order: string;
          user_id: string | null;
          plan_code: string;
          amount: string;
          status: PaymentOrderView['status'];
          authorized_amount: string | null;
          response_code: string | null;
          created_at: Date;
          committed_at: Date | null;
          activated_at: Date | null;
          has_token: boolean;
        }>(
          `SELECT buy_order, user_id, plan_code, amount, status, authorized_amount, response_code, created_at, committed_at, activated_at,
                  provider_token IS NOT NULL AS has_token
             FROM app.payment_orders
            WHERE ($1::text IS NULL OR status = $1) AND ($2::date IS NULL OR created_at >= $2::date)
              AND ($3::date IS NULL OR created_at < $3::date + 1) AND ($4::text IS NULL OR buy_order = $4)
            ORDER BY created_at DESC LIMIT $5`,
          [filter.status ?? null, filter.from ?? null, filter.to ?? null, filter.buyOrder ?? null, filter.limit],
        );
        return rows.map(
          (row): PaymentOrderView => ({
            buyOrder: row.buy_order,
            userId: row.user_id,
            planCode: row.plan_code,
            amount: Number(row.amount),
            status: row.status,
            authorizedAmount: row.authorized_amount === null ? null : Number(row.authorized_amount),
            responseCode: row.response_code,
            createdAt: row.created_at,
            committedAt: row.committed_at,
            activatedAt: row.activated_at,
            hasProviderToken: row.has_token,
          }),
        );
      });
    },

    async providerTokenOf(buyOrder) {
      return read(async (client) => {
        const { rows } = await client.query<{ provider_token: string | null }>('SELECT provider_token FROM app.payment_orders WHERE buy_order = $1', [buyOrder]);
        return rows[0]?.provider_token ?? null;
      });
    },

    async metrics() {
      return read(async (client) => {
        const users = await client.query<{ users: string; verified: string; suspended: string; started: string; completed: string; median_minutes: number | null }>(
          `SELECT count(*) AS users,
                  count(*) FILTER (WHERE email_verified_at IS NOT NULL) AS verified,
                  count(*) FILTER (WHERE status = 'suspended') AS suspended,
                  count(onboarding_started_at) AS started,
                  count(onboarding_completed_at) AS completed,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM onboarding_completed_at - onboarding_started_at) / 60)
                    FILTER (WHERE onboarding_completed_at IS NOT NULL) AS median_minutes
             FROM app.users`,
        );
        const subscriptions = await client.query<{ plan_code: string; n: string }>(
          `SELECT plan_code, count(*) AS n FROM app.subscriptions WHERE period_start <= ${CHILE_TODAY} AND period_end > ${CHILE_TODAY} GROUP BY plan_code`,
        );
        const row = users.rows[0];
        return {
          users: Number(row?.users ?? 0),
          verifiedUsers: Number(row?.verified ?? 0),
          suspendedUsers: Number(row?.suspended ?? 0),
          onboardingStarted: Number(row?.started ?? 0),
          onboardingCompleted: Number(row?.completed ?? 0),
          onboardingMedianMinutes: row?.median_minutes === null || row?.median_minutes === undefined ? null : Math.round(row.median_minutes),
          activeSubscriptions: Object.fromEntries(subscriptions.rows.map((s) => [s.plan_code, Number(s.n)])),
        };
      });
    },

    async recordAdminAction(admin, action, targetType, targetId) {
      await read((client) => audit(client, admin, action, targetType, targetId));
    },
  };
}
