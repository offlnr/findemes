import type pg from 'pg';
import type { ContributionRule, HouseholdMember, HouseholdSnapshot, SharedExpense } from '../../modules/household/domain/household.ts';
import type { HouseholdRepository, SharedExpenseDraft } from '../../modules/household/ports/household-ports.ts';
import type { HouseholdId, UserId } from '../../modules/shared/actor.ts';
import type { TransactionRunner, WriteContext } from '../../modules/shared/ports.ts';
import { MONTH, scheduleColumns, scheduleOf, toDate, type ScheduleRow } from './pg-registry-store.ts';
import { clientOf } from './pg-transaction-runner.ts';

const UNIQUE_VIOLATION = '23505';
const RLS_VIOLATION = '42501';

const isPgError = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

async function audit(client: pg.PoolClient, context: WriteContext, action: string, targetType: string, targetId: string | null) {
  // The trigger fills time and chain fields; no values are recorded (HU25).
  await client.query(
    `INSERT INTO app.audit_log (actor_type, actor_id, action, target_type, target_id, origin_ip, occurred_at, prev_hash, hash, seq)
     VALUES ('user', $1, $2, $3, $4, $5::inet, now(), '\\x00', '\\x00', 0)`,
    [context.actor.userId, action, targetType, targetId, context.ip],
  );
}

/** Replaces the split rule of an expense. An equal split is the absence of a rule (decision 20-10-2026). */
async function writeRule(client: pg.PoolClient, householdId: HouseholdId, expenseId: string, rule: ContributionRule) {
  await client.query('DELETE FROM app.contribution_rules WHERE expense_id = $1', [expenseId]);
  if (rule.mode === 'equal') return;
  await client.query('INSERT INTO app.contribution_rules (expense_id, household_id, mode, assigned_user_id) VALUES ($1, $2, $3, $4)', [
    expenseId,
    householdId,
    rule.mode,
    rule.mode === 'assigned' ? rule.userId : null,
  ]);
  if (rule.mode === 'percentage') {
    await client.query(
      `INSERT INTO app.contribution_shares (expense_id, household_id, user_id, basis_points)
       SELECT $1, $2, u, b FROM unnest($3::uuid[], $4::integer[]) AS t(u, b)`,
      [expenseId, householdId, rule.shares.map((share) => share.userId), rule.shares.map((share) => share.basisPoints)],
    );
  }
}

/**
 * PostgreSQL household space (migrations 0004 and 0013). Runs as the actor: Row-Level Security
 * limits every statement to the actor's own household, and only to shared data.
 */
export function createPgHouseholdStore(runner: TransactionRunner): HouseholdRepository {
  const write = <T>(context: WriteContext, work: (client: pg.PoolClient) => Promise<T>) => runner.withActor(context.actor, (tx) => work(clientOf(tx)));

  async function householdOf(client: pg.PoolClient, userId: string): Promise<HouseholdId | null> {
    const { rows } = await client.query<{ household_id: string }>('SELECT household_id FROM app.household_members WHERE user_id = $1', [userId]);
    return (rows[0]?.household_id ?? null) as HouseholdId | null;
  }

  return {
    async findForActor(actor) {
      return runner.withActor(actor, async (tx) => {
        const client = clientOf(tx);
        const householdId = await householdOf(client, actor.userId);
        if (householdId === null) return null;
        const household = await client.query<{ name: string; active: boolean }>(
          'SELECT name, app.household_space_active(id) AS active FROM app.households WHERE id = $1',
          [householdId],
        );
        const head = household.rows[0];
        if (head === undefined) return null;
        const members = await client.query<{ user_id: string; display_name: string; role: HouseholdMember['role']; joined_at: Date }>(
          'SELECT user_id, display_name, role, joined_at FROM app.household_members WHERE household_id = $1 ORDER BY joined_at, user_id',
          [householdId],
        );
        const expenses = await client.query<ScheduleRow & { created_by: string | null; created_by_name: string }>(
          `SELECT id, label, amount, schedule_kind, interval_months, ${MONTH('from_month')} AS from_month, ${MONTH('until_month')} AS until_month,
                  created_by, created_by_name
             FROM app.household_expenses WHERE household_id = $1 ORDER BY created_at, id`,
          [householdId],
        );
        const rules = await client.query<{ expense_id: string; mode: 'percentage' | 'assigned'; assigned_user_id: string | null }>(
          'SELECT expense_id, mode, assigned_user_id FROM app.contribution_rules WHERE household_id = $1',
          [householdId],
        );
        const shares = await client.query<{ expense_id: string; user_id: string; basis_points: number }>(
          'SELECT expense_id, user_id, basis_points FROM app.contribution_shares WHERE household_id = $1 ORDER BY user_id',
          [householdId],
        );
        const ruleOf = (expenseId: string): ContributionRule => {
          const rule = rules.rows.find((row) => row.expense_id === expenseId);
          if (rule === undefined) return { mode: 'equal' };
          if (rule.mode === 'assigned' && rule.assigned_user_id !== null) return { mode: 'assigned', userId: rule.assigned_user_id as UserId };
          return {
            mode: 'percentage',
            shares: shares.rows.filter((row) => row.expense_id === expenseId).map((row) => ({ userId: row.user_id as UserId, basisPoints: row.basis_points })),
          };
        };
        const snapshot: HouseholdSnapshot = {
          id: householdId,
          name: head.name,
          spaceActive: head.active,
          members: members.rows.map((row) => ({ userId: row.user_id as UserId, displayName: row.display_name, role: row.role, joinedAt: row.joined_at })),
          expenses: expenses.rows.map(
            (row): SharedExpense => ({
              id: row.id,
              label: row.label,
              amount: Number(row.amount),
              schedule: scheduleOf(row),
              createdBy: row.created_by as UserId | null,
              createdByName: row.created_by_name,
              rule: ruleOf(row.id),
            }),
          ),
        };
        return snapshot;
      });
    },

    async create(context, name, displayName) {
      try {
        return await write(context, async (client) => {
          if ((await householdOf(client, context.actor.userId)) !== null) return 'already_member' as const;
          const { rows } = await client.query<{ id: string }>('SELECT app.create_household($1, $2) AS id', [name, displayName]);
          const id = rows[0]?.id as HouseholdId;
          await audit(client, context, 'household.created', 'household', id);
          return id;
        });
      } catch (error) {
        if (isPgError(error, UNIQUE_VIOLATION)) return 'already_member';
        throw error;
      }
    },

    async createInvitation(context, householdId, tokenHash, expiresAt) {
      try {
        return await write(context, async (client) => {
          const { rows } = await client.query<{ id: string }>(
            'INSERT INTO app.household_invitations (household_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id',
            [householdId, Buffer.from(tokenHash), expiresAt],
          );
          await audit(client, context, 'household.invitation_created', 'household_invitation', rows[0]?.id ?? null);
          return true;
        });
      } catch (error) {
        if (isPgError(error, RLS_VIOLATION)) return false;
        throw error;
      }
    },

    async previewInvitation(tokenHash) {
      return runner.withActor(null, async (tx) => {
        const { rows } = await clientOf(tx).query<{ household_name: string; member_count: number; expires_at: Date }>(
          'SELECT household_name, member_count, expires_at FROM app.preview_household_invitation($1)',
          [Buffer.from(tokenHash)],
        );
        const row = rows[0];
        return row === undefined ? null : { householdName: row.household_name, memberCount: row.member_count, expiresAt: row.expires_at };
      });
    },

    async acceptInvitation(context, tokenHash, displayName) {
      try {
        return await write(context, async (client) => {
          if ((await householdOf(client, context.actor.userId)) !== null) return 'already_member' as const;
          const { rows } = await client.query<{ id: string | null }>('SELECT app.accept_household_invitation($1, $2) AS id', [Buffer.from(tokenHash), displayName]);
          const id = rows[0]?.id ?? null;
          if (id === null) return 'invalid' as const;
          await audit(client, context, 'household.member_joined', 'household', id);
          return id as HouseholdId;
        });
      } catch (error) {
        if (isPgError(error, UNIQUE_VIOLATION)) return 'already_member';
        throw error;
      }
    },

    async removeMember(context, householdId, userId) {
      return write(context, async (client) => {
        const { rowCount } = await client.query('DELETE FROM app.household_members WHERE household_id = $1 AND user_id = $2', [householdId, userId]);
        if (rowCount === 0) return false;
        await audit(client, context, userId === context.actor.userId ? 'household.member_left' : 'household.member_removed', 'household_member', userId);
        return true;
      });
    },

    async addExpense(context, householdId, expense: SharedExpenseDraft) {
      await write(context, async (client) => {
        const [kind, interval, from, until] = scheduleColumns(expense.schedule);
        await client.query(
          `INSERT INTO app.household_expenses (id, household_id, created_by, created_by_name, label, amount, schedule_kind, interval_months, from_month, until_month)
           VALUES ($1, $2, $3, '-', $4, $5, $6, $7, ${toDate('$8')}, ${toDate('$9')})`,
          [expense.id, householdId, context.actor.userId, expense.label, expense.amount, kind, interval, from, until],
        );
        await writeRule(client, householdId, expense.id, expense.rule);
        await audit(client, context, 'household.expense_created', 'household_expense', expense.id);
      });
    },

    async updateExpense(context, householdId, expense) {
      return write(context, async (client) => {
        const [kind, interval, from, until] = scheduleColumns(expense.schedule);
        const { rowCount } = await client.query(
          `UPDATE app.household_expenses SET label = $3, amount = $4, schedule_kind = $5, interval_months = $6,
             from_month = ${toDate('$7')}, until_month = ${toDate('$8')}, updated_at = now()
           WHERE id = $1 AND household_id = $2`,
          [expense.id, householdId, expense.label, expense.amount, kind, interval, from, until],
        );
        if (rowCount === 0) return false;
        // Only admins may write rules (RLS); the service never sends a rule change from a member.
        const admin = await client.query<{ is_admin: boolean }>('SELECT app.is_household_admin($1) AS is_admin', [householdId]);
        if (admin.rows[0]?.is_admin === true) await writeRule(client, householdId, expense.id, expense.rule);
        await audit(client, context, 'household.expense_updated', 'household_expense', expense.id);
        return true;
      });
    },

    async deleteExpense(context, householdId, expenseId) {
      return write(context, async (client) => {
        const { rowCount } = await client.query('DELETE FROM app.household_expenses WHERE id = $1 AND household_id = $2', [expenseId, householdId]);
        if (rowCount === 0) return false;
        await audit(client, context, 'household.expense_deleted', 'household_expense', expenseId);
        return true;
      });
    },
  };
}
