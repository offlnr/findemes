import { addMonths, compareYearMonth, isWithinRange, monthsBetween, type YearMonth } from '../calendar/year-month.ts';
import type { FinancialState, Schedule } from '../financial-state/financial-state.ts';
import { clp, type Clp } from '../money/clp.ts';
import type { ProjectedMonth, Projection } from './projection.ts';

/** Upper bound of the configurable horizon (HU05); keeps every request cheap to compute. */
export const MAX_HORIZON_MONTHS = 120;

export function isScheduledIn(schedule: Schedule, month: YearMonth): boolean {
  switch (schedule.kind) {
    case 'once':
      return compareYearMonth(schedule.month, month) === 0;
    case 'monthly':
      return isWithinRange(month, schedule);
    case 'every_n_months':
      return isWithinRange(month, schedule) && monthsBetween(schedule.from, month) % schedule.intervalMonths === 0;
  }
}

function sumScheduled(entries: readonly { readonly amount: Clp; readonly schedule: Schedule }[], month: YearMonth): number {
  let total = 0;
  for (const entry of entries) {
    if (isScheduledIn(entry.schedule, month)) {
      total += entry.amount;
    }
  }
  return total;
}

/**
 * Monthly cash-flow projection (HU05). Pure: the state is read, never modified.
 * Each month: closing = opening + income - expenses - debt installments.
 */
export function project(state: FinancialState, horizonMonths: number): Projection {
  if (!Number.isInteger(horizonMonths) || horizonMonths < 1 || horizonMonths > MAX_HORIZON_MONTHS) {
    throw new RangeError(`Horizon must be an integer between 1 and ${String(MAX_HORIZON_MONTHS)} months`);
  }

  const debtByOffset = new Array<number>(horizonMonths).fill(0);
  for (const debt of state.debts) {
    for (const installment of debt.installments) {
      const offset = monthsBetween(state.startMonth, installment.month);
      if (offset >= 0 && offset < horizonMonths) {
        debtByOffset[offset] = (debtByOffset[offset] ?? 0) + installment.amount;
      }
    }
  }

  const months: ProjectedMonth[] = [];
  let balance: number = state.openingBalance;
  for (let offset = 0; offset < horizonMonths; offset++) {
    const month = addMonths(state.startMonth, offset);
    const income = sumScheduled(state.incomes, month);
    const expenses = sumScheduled(state.expenses, month);
    const debtPayments = debtByOffset[offset] ?? 0;
    const netFlow = income - expenses - debtPayments;
    const openingBalance = balance;
    balance += netFlow;
    months.push(
      Object.freeze({
        month,
        openingBalance: clp(openingBalance),
        income: clp(income),
        expenses: clp(expenses),
        debtPayments: clp(debtPayments),
        netFlow: clp(netFlow),
        closingBalance: clp(balance),
      }),
    );
  }

  return Object.freeze({ months: Object.freeze(months) });
}
