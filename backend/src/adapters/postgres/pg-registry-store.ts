import type pg from 'pg';
import { formatYearMonth, parseYearMonth, type Schedule } from '../../core/index.ts';
import type { OpeningBalance, RegistryDebt, RegistryExpense, ScheduledEntry } from '../../modules/registry/domain/registry.ts';
import type { RegistryRepository, WriteContext } from '../../modules/registry/ports/registry-ports.ts';
import type { TransactionRunner } from '../../modules/shared/ports.ts';
import { clientOf } from './pg-transaction-runner.ts';

// Months travel as 'YYYY-MM' text and are stored as the first day of the month (app.month), so
// the driver's time zone handling of DATE never shifts a month.
const MONTH = (column: string) => `to_char(${column}, 'YYYY-MM')`;
const toDate = (param: string) => `(${param} || '-01')::date`;

interface ScheduleRow {
  id: string;
  label: string;
  amount: string;
  schedule_kind: Schedule['kind'];
  interval_months: number | null;
  from_month: string;
  until_month: string | null;
}

function scheduleOf(row: ScheduleRow): Schedule {
  const from = parseYearMonth(row.from_month);
  const until = row.until_month === null ? null : parseYearMonth(row.until_month);
  switch (row.schedule_kind) {
    case 'once':
      return { kind: 'once', month: from };
    case 'monthly':
      return { kind: 'monthly', from, until };
    case 'every_n_months':
      return { kind: 'every_n_months', intervalMonths: row.interval_months ?? 2, from, until };
  }
}

/** Columns of a schedule: a single month is stored as from_month with no end. */
function scheduleColumns(schedule: Schedule): [Schedule['kind'], number | null, string, string | null] {
  if (schedule.kind === 'once') return ['once', null, formatYearMonth(schedule.month), null];
  const until = schedule.until === null ? null : formatYearMonth(schedule.until);
  return [schedule.kind, schedule.kind === 'every_n_months' ? schedule.intervalMonths : null, formatYearMonth(schedule.from), until];
}

/**
 * PostgreSQL registry (migration 0003). Each write runs as the actor, so Row-Level Security
 * hides other owners' rows, and appends its audit entry in the same transaction (HU25).
 */
export function createPgRegistryStore(runner: TransactionRunner): RegistryRepository {
  async function audit(client: pg.PoolClient, context: WriteContext, action: string, targetType: string, targetId: string | null) {
    // The trigger fills time and chain fields; details carry no values (HU25).
    await client.query(
      `INSERT INTO app.audit_log (actor_type, actor_id, action, target_type, target_id, origin_ip, occurred_at, prev_hash, hash, seq)
       VALUES ('user', $1, $2, $3, $4, $5::inet, now(), '\\x00', '\\x00', 0)`,
      [context.actor.userId, action, targetType, targetId, context.ip],
    );
  }

  const write = <T>(context: WriteContext, work: (client: pg.PoolClient) => Promise<T>) =>
    runner.withActor(context.actor, (tx) => work(clientOf(tx)));

  function scheduled(table: 'incomes' | 'expenses', targetType: 'income' | 'expense') {
    const extraColumn = table === 'expenses' ? ', nature' : '';
    return {
      async create(context: WriteContext, entry: ScheduledEntry & Partial<Pick<RegistryExpense, 'nature'>>) {
        await write(context, async (client) => {
          const [kind, interval, from, until] = scheduleColumns(entry.schedule);
          await client.query(
            `INSERT INTO app.${table} (id, owner_id, label, amount, schedule_kind, interval_months, from_month, until_month${extraColumn})
             VALUES ($1, $2, $3, $4, $5, $6, ${toDate('$7')}, ${toDate('$8')}${table === 'expenses' ? ', $9' : ''})`,
            [entry.id, context.actor.userId, entry.label, entry.amount, kind, interval, from, until, ...(table === 'expenses' ? [entry.nature] : [])],
          );
          await audit(client, context, `registry.${targetType}_created`, targetType, entry.id);
        });
      },
      async update(context: WriteContext, entry: ScheduledEntry & Partial<Pick<RegistryExpense, 'nature'>>) {
        return write(context, async (client) => {
          const [kind, interval, from, until] = scheduleColumns(entry.schedule);
          const { rowCount } = await client.query(
            `UPDATE app.${table} SET label = $2, amount = $3, schedule_kind = $4, interval_months = $5,
               from_month = ${toDate('$6')}, until_month = ${toDate('$7')}${table === 'expenses' ? ', nature = $8' : ''}, updated_at = now()
             WHERE id = $1`,
            [entry.id, entry.label, entry.amount, kind, interval, from, until, ...(table === 'expenses' ? [entry.nature] : [])],
          );
          if (rowCount === 0) return false;
          await audit(client, context, `registry.${targetType}_updated`, targetType, entry.id);
          return true;
        });
      },
      async remove(context: WriteContext, id: string) {
        return write(context, async (client) => {
          const { rowCount } = await client.query(`DELETE FROM app.${table} WHERE id = $1`, [id]);
          if (rowCount === 0) return false;
          await audit(client, context, `registry.${targetType}_deleted`, targetType, id);
          return true;
        });
      },
    };
  }

  const incomes = scheduled('incomes', 'income');
  const expenses = scheduled('expenses', 'expense');

  async function insertInstallments(client: pg.PoolClient, context: WriteContext, debt: RegistryDebt) {
    if (debt.installments.length === 0) return;
    await client.query(
      `INSERT INTO app.debt_installments (debt_id, owner_id, month, amount)
       SELECT $1, $2, (m || '-01')::date, a FROM unnest($3::text[], $4::bigint[]) AS t(m, a)`,
      [debt.id, context.actor.userId, debt.installments.map((i) => formatYearMonth(i.month)), debt.installments.map((i) => i.amount)],
    );
  }

  return {
    async load(actor) {
      return runner.withActor(actor, async (tx) => {
        const client = clientOf(tx);
        const columns = `id, label, amount, schedule_kind, interval_months, ${MONTH('from_month')} AS from_month, ${MONTH('until_month')} AS until_month`;
        // One connection runs one query at a time, so these are awaited in sequence.
        const balance = await client.query<{ opening_balance: string; balance_month: string }>(
          `SELECT opening_balance, ${MONTH('balance_month')} AS balance_month FROM app.financial_profiles WHERE owner_id = $1`,
          [actor.userId],
        );
        const incomeRows = await client.query<ScheduleRow>(`SELECT ${columns} FROM app.incomes WHERE owner_id = $1 ORDER BY created_at, id`, [actor.userId]);
        const expenseRows = await client.query<ScheduleRow & { nature: RegistryExpense['nature'] }>(
          `SELECT ${columns}, nature FROM app.expenses WHERE owner_id = $1 ORDER BY created_at, id`,
          [actor.userId],
        );
        const debtRows = await client.query<{ id: string; label: string; total_installments: number | null }>(
          'SELECT id, label, total_installments FROM app.debts WHERE owner_id = $1 ORDER BY created_at, id',
          [actor.userId],
        );
        const installmentRows = await client.query<{ debt_id: string; month: string; amount: string }>(
          `SELECT debt_id, ${MONTH('month')} AS month, amount FROM app.debt_installments WHERE owner_id = $1 ORDER BY debt_id, month`,
          [actor.userId],
        );
        const balanceRow = balance.rows[0];
        const openingBalance: OpeningBalance | null =
          balanceRow === undefined ? null : { amount: Number(balanceRow.opening_balance), month: parseYearMonth(balanceRow.balance_month) };
        return {
          openingBalance,
          incomes: incomeRows.rows.map((row) => ({ id: row.id, label: row.label, amount: Number(row.amount), schedule: scheduleOf(row) })),
          expenses: expenseRows.rows.map((row) => ({ id: row.id, label: row.label, amount: Number(row.amount), nature: row.nature, schedule: scheduleOf(row) })),
          debts: debtRows.rows.map((row) => ({
            id: row.id,
            label: row.label,
            totalInstallments: row.total_installments,
            installments: installmentRows.rows
              .filter((installment) => installment.debt_id === row.id)
              .map((installment) => ({ month: parseYearMonth(installment.month), amount: Number(installment.amount) })),
          })),
        };
      });
    },

    async setOpeningBalance(context, balance) {
      await write(context, async (client) => {
        await client.query(
          `INSERT INTO app.financial_profiles (owner_id, opening_balance, balance_month) VALUES ($1, $2, ${toDate('$3')})
           ON CONFLICT (owner_id) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, balance_month = EXCLUDED.balance_month, updated_at = now()`,
          [context.actor.userId, balance.amount, formatYearMonth(balance.month)],
        );
        await audit(client, context, 'registry.opening_balance_set', 'financial_profile', context.actor.userId);
      });
    },

    createIncome: (context, income) => incomes.create(context, income),
    createExpense: (context, expense) => expenses.create(context, expense),
    updateIncome: (context, income) => incomes.update(context, income),
    updateExpense: (context, expense) => expenses.update(context, expense),
    deleteIncome: (context, id) => incomes.remove(context, id),
    deleteExpense: (context, id) => expenses.remove(context, id),

    async createDebt(context, debt) {
      await write(context, async (client) => {
        await client.query('INSERT INTO app.debts (id, owner_id, label, total_installments) VALUES ($1, $2, $3, $4)', [
          debt.id,
          context.actor.userId,
          debt.label,
          debt.totalInstallments,
        ]);
        await insertInstallments(client, context, debt);
        await audit(client, context, 'registry.debt_created', 'debt', debt.id);
      });
    },

    async updateDebt(context, debt) {
      return write(context, async (client) => {
        const { rowCount } = await client.query('UPDATE app.debts SET label = $2, total_installments = $3, updated_at = now() WHERE id = $1', [
          debt.id,
          debt.label,
          debt.totalInstallments,
        ]);
        if (rowCount === 0) return false;
        await client.query('DELETE FROM app.debt_installments WHERE debt_id = $1', [debt.id]);
        await insertInstallments(client, context, debt);
        await audit(client, context, 'registry.debt_updated', 'debt', debt.id);
        return true;
      });
    },

    async deleteDebt(context, id) {
      return write(context, async (client) => {
        const { rowCount } = await client.query('DELETE FROM app.debts WHERE id = $1', [id]);
        if (rowCount === 0) return false;
        await audit(client, context, 'registry.debt_deleted', 'debt', id);
        return true;
      });
    },
  };
}
