import { compareYearMonth, type MonthRange } from '../../calendar/year-month.ts';
import type { EntryId, Expense, FinancialState } from '../../financial-state/financial-state.ts';
import { clp } from '../../money/clp.ts';
import { formatClpEs } from '../../text/spanish.ts';
import type { FixedExpenseChangeParams } from '../catalog-params.ts';
import type { DecisionType } from '../decision.ts';
import { ParamsReader } from '../params-reader.ts';
import { describeRange } from './range-text.ts';

type MonthlyFixedExpense = Expense & { readonly schedule: { readonly kind: 'monthly' } & MonthRange };

function findTarget(state: FinancialState, id: EntryId | null): MonthlyFixedExpense | undefined {
  const target = state.expenses.find((expense) => expense.id === id);
  return target?.nature === 'fixed' && target.schedule.kind === 'monthly' ? (target as MonthlyFixedExpense) : undefined;
}

/** Months where both ranges apply, or `null` when they do not overlap. */
function intersect(a: MonthRange, b: MonthRange): MonthRange | null {
  const from = compareYearMonth(a.from, b.from) >= 0 ? a.from : b.from;
  const until = a.until === null ? b.until : b.until === null ? a.until : compareYearMonth(a.until, b.until) <= 0 ? a.until : b.until;
  return until !== null && compareYearMonth(until, from) < 0 ? null : { from, until };
}

/**
 * "Alta o modificación de gasto fijo" (Tabla 11). A modification keeps the registered expense
 * untouched and adds an adjustment (new amount minus current amount) in the affected months.
 */
export const fixedExpenseChange: DecisionType<'fixed_expense_change', FixedExpenseChangeParams> = {
  kind: 'fixed_expense_change',

  parseParams(raw, state) {
    const reader = ParamsReader.open(raw, ['label', 'targetExpenseId', 'amount', 'range']);
    let targetExpenseId: EntryId | null = null;
    let target: MonthlyFixedExpense | undefined;
    if (reader.has('targetExpenseId')) {
      const rawId = reader.string('targetExpenseId');
      target = rawId === undefined ? undefined : findTarget(state, rawId as EntryId);
      if (rawId !== undefined && target === undefined) {
        reader.fail('targetExpenseId', 'Selecciona un gasto fijo mensual registrado.');
      }
      targetExpenseId = target?.id ?? null;
    }

    const isNew = !reader.has('targetExpenseId');
    const label = isNew || reader.has('label') ? reader.label('label') : target?.label;
    const amount = reader.amount('amount', isNew ? 'positive' : 'non_negative');
    const range = reader.range('range');
    if (target !== undefined && range !== undefined && intersect(range, target.schedule) === null) {
      reader.fail('range', 'El rango no coincide con los meses en que existe el gasto.');
    }

    if (label === undefined || amount === undefined || range === undefined || reader.issues.length > 0) {
      return reader.failure();
    }
    return { ok: true, value: { label, targetExpenseId, amount, range } };
  },

  apply(state, params, context) {
    const target = findTarget(state, params.targetExpenseId);
    const affected = target === undefined ? params.range : intersect(params.range, target.schedule);
    if (affected === null) {
      return state;
    }
    const expense: Expense = {
      id: context.entryId(0),
      label: params.label,
      nature: 'fixed',
      amount: target === undefined ? params.amount : clp(params.amount - target.amount),
      schedule: { kind: 'monthly', from: affected.from, until: affected.until },
    };
    return { ...state, expenses: [...state.expenses, expense] };
  },

  describe(params, state) {
    const target = findTarget(state, params.targetExpenseId);
    if (target === undefined) {
      return `Nuevo gasto fijo «${params.label}» de ${formatClpEs(params.amount)} mensuales ${describeRange(params.range)}.`;
    }
    return (
      `El gasto fijo «${target.label}» pasa de ${formatClpEs(target.amount)} a ${formatClpEs(params.amount)} ` +
      `mensuales ${describeRange(params.range)}.`
    );
  },
};
