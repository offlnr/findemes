import type { YearMonth } from '../calendar/year-month.ts';
import type { Clp } from '../money/clp.ts';

/** One month of the cash-flow projection (HU05). */
export interface ProjectedMonth {
  readonly month: YearMonth;
  readonly openingBalance: Clp;
  readonly income: Clp;
  readonly expenses: Clp;
  readonly debtPayments: Clp;
  /** income - expenses - debtPayments */
  readonly netFlow: Clp;
  readonly closingBalance: Clp;
}

export interface Projection {
  readonly months: readonly ProjectedMonth[];
}
