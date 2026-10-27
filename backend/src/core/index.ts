// Public API of the simulation core. Other layers import from here only.
export type { MonthRange, YearMonth } from './calendar/year-month.ts';
export {
  addMonths,
  compareYearMonth,
  formatYearMonth,
  isWithinRange,
  monthsBetween,
  parseYearMonth,
  yearMonth,
} from './calendar/year-month.ts';

export type { Clp } from './money/clp.ts';
export { addClp, clp, subtractClp } from './money/clp.ts';

export type {
  Debt,
  EntryId,
  Expense,
  FinancialState,
  Income,
  Installment,
  Schedule,
} from './financial-state/financial-state.ts';

export type {
  DecisionContext,
  DecisionInput,
  DecisionIssue,
  DecisionType,
  ParseResult,
} from './decisions/decision.ts';
export type { DecisionCatalog } from './decisions/catalog.ts';
export { createDecisionCatalog } from './decisions/catalog.ts';
export type {
  DebtPrepaymentParams,
  FixedExpenseChangeParams,
  IncomeVariationParams,
  MvpDecisionKind,
  OneOffExpenseParams,
  PrepaymentModality,
  PurchaseInInstallmentsParams,
} from './decisions/catalog-params.ts';
export { MVP_DECISION_KINDS } from './decisions/catalog-params.ts';

export type { ProjectedMonth, Projection } from './projection/projection.ts';
export type {
  IndicatorVariation,
  Indicators,
  MonthlyAmount,
  MonthlyRatio,
} from './indicators/indicators.ts';
export type { Explanation } from './explanation/explanation.ts';
export type {
  ScenarioOutcome,
  Simulate,
  SimulationOutcome,
  SimulationRequest,
  SimulationResult,
} from './simulation/simulation.ts';

export { MAX_HORIZON_MONTHS, project } from './projection/project.ts';
export { computeIndicators, computeVariation } from './indicators/compute.ts';
export { createMvpCatalog, MVP_DECISION_TYPES } from './decisions/mvp/mvp-catalog.ts';
export { MAX_DECISION_AMOUNT } from './decisions/params-reader.ts';
export { simulate } from './simulation/simulate.ts';
export { formatClpEs, formatMonthEs } from './text/spanish.ts';
