import {
  createMvpCatalog,
  simulate,
  type DecisionInput,
  type DecisionIssue,
  type FinancialState,
  type SimulationResult,
  type YearMonth,
} from '../../../core/index.ts';
import { buildExampleState, buildOwnDataState } from '../domain/demo-examples.ts';
import { DEMO_LIMITS } from '../domain/demo-limits.ts';

export type DemoBase =
  | { readonly example: string }
  | { readonly openingBalance: number; readonly monthlyIncome: number; readonly monthlyFixedExpense: number };

export interface DemoProjectionRequest {
  readonly base: DemoBase;
  /** HU27-28: at most one simulated decision (DEMO_LIMITS.maxDecisions). */
  readonly decision: DecisionInput | null;
}

export type DemoProjectionOutcome =
  | {
      readonly ok: true;
      readonly state: FinancialState;
      readonly horizonMonths: number;
      readonly hasDecision: boolean;
      readonly result: SimulationResult;
    }
  | { readonly ok: false; readonly reason: 'unknown_example' }
  | { readonly ok: false; readonly reason: 'invalid_decision'; readonly issues: readonly DecisionIssue[] };

const catalog = createMvpCatalog();

/**
 * Demo projection (HU27, HU28). Stateless: builds the base state from a fictitious example or
 * from the visitor's minimal data, simulates at most one decision and returns the result.
 * Nothing is stored or logged; the calculation stays on the server (rule 8).
 */
export function runDemoProjection(request: DemoProjectionRequest, startMonth: YearMonth): DemoProjectionOutcome {
  const isExample = 'example' in request.base;
  const state = 'example' in request.base ? buildExampleState(request.base.example, startMonth) : buildOwnDataState(request.base, startMonth);
  if (state === undefined) {
    return { ok: false, reason: 'unknown_example' };
  }

  const horizonMonths = isExample ? DEMO_LIMITS.exampleHorizonMonths : DEMO_LIMITS.horizonMonths;
  const decisions = request.decision === null ? [] : [request.decision];
  const outcome = simulate({ state, decisions, horizonMonths }, catalog);
  if (!outcome.ok) {
    return { ok: false, reason: 'invalid_decision', issues: outcome.issues.flatMap((entry) => entry.issues) };
  }
  return { ok: true, state, horizonMonths, hasDecision: decisions.length > 0, result: outcome.result };
}
