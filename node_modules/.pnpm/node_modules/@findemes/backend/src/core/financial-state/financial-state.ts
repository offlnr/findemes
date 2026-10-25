import type { YearMonth } from '../calendar/year-month.ts';
import type { Clp } from '../money/clp.ts';

/** Identifier assigned outside the core (by the registry, or by the engine for decisions). */
export type EntryId = string & { readonly __brand: 'EntryId' };

/**
 * When an amount applies. The report asks for "periodicidad" (HU01) without listing values.
 * - `once`: a single month (sporadic income, one-off expense).
 * - `monthly`: every month from `from` to `until` inclusive; `until: null` has no end.
 * - `every_n_months`: every `intervalMonths` (>= 2) months, anchored at `from`
 *   (e.g. a quarterly or yearly bonus).
 */
export type Schedule =
  | { readonly kind: 'once'; readonly month: YearMonth }
  | { readonly kind: 'monthly'; readonly from: YearMonth; readonly until: YearMonth | null }
  | {
      readonly kind: 'every_n_months';
      readonly intervalMonths: number;
      readonly from: YearMonth;
      readonly until: YearMonth | null;
    };

interface ScheduledAmount {
  readonly id: EntryId;
  /** User-given name, used only to make explanations readable. */
  readonly label: string;
  /** Positive amount in the registry; decisions may add negative adjustments. */
  readonly amount: Clp;
  readonly schedule: Schedule;
}

/** HU01: recurring or sporadic income. */
export type Income = ScheduledAmount;

/** HU02: fixed recurring expense or estimated variable expense. */
export interface Expense extends ScheduledAmount {
  readonly nature: 'fixed' | 'variable_estimate';
}

export interface Installment {
  readonly month: YearMonth;
  readonly amount: Clp;
}

/**
 * HU03: debt as its explicit schedule of pending installments, in chronological order.
 * The registry builds it from the HU03 input (installment amount, number pending, next month);
 * an explicit schedule also represents unequal installments left by splits or prepayments.
 * Installments end on their own after the last month ("se agotan al término del plazo").
 */
export interface Debt {
  readonly id: EntryId;
  readonly label: string;
  readonly installments: readonly Installment[];
}

/**
 * Engine input describing a person's or household's finances (HU01-HU04).
 * Immutable: a scenario derives a new value and never alters the base (rule 3).
 */
export interface FinancialState {
  /** First projected month. Supplied by the caller; the core never reads the clock. */
  readonly startMonth: YearMonth;
  /** HU04: positive or negative balance at the start of `startMonth`. */
  readonly openingBalance: Clp;
  readonly incomes: readonly Income[];
  readonly expenses: readonly Expense[];
  readonly debts: readonly Debt[];
}
