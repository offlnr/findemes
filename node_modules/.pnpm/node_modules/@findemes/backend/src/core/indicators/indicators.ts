import type { YearMonth } from '../calendar/year-month.ts';
import type { Clp } from '../money/clp.ts';

/** Indicators of one projected scenario (Tabla 12). */
export interface Indicators {
  /** Lowest closing balance within the horizon and the first month it occurs. */
  readonly minimumProjectedBalance: { readonly amount: Clp; readonly month: YearMonth };
  /** First month whose closing balance is negative; `null` when it does not happen. */
  readonly breakMonth: YearMonth | null;
  /** Income minus total commitments, for each month. */
  readonly monthlyAvailableMargin: readonly MonthlyAmount[];
  /** Share of income committed to installments and debts, for each month. */
  readonly debtToIncome: readonly MonthlyRatio[];
}

export interface MonthlyAmount {
  readonly month: YearMonth;
  readonly amount: Clp;
}

export interface MonthlyRatio {
  readonly month: YearMonth;
  /**
   * Integer basis points (10 000 = 100 %) to stay free of floating-point drift.
   * `null` when the month has no income and the ratio is undefined.
   */
  readonly basisPoints: number | null;
}

/**
 * "Variación respecto del escenario base" (Tabla 12): signed difference of each indicator,
 * scenario minus base. Neutral by design (rule 4): it never states which side is preferable.
 */
export interface IndicatorVariation {
  readonly minimumProjectedBalance: Clp;
  readonly breakMonth: { readonly base: YearMonth | null; readonly scenario: YearMonth | null };
  readonly monthlyAvailableMargin: readonly MonthlyAmount[];
  readonly debtToIncome: readonly MonthlyRatio[];
}
