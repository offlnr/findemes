import type { DecisionCatalog } from '../decisions/catalog.ts';
import type { DecisionInput, DecisionIssue } from '../decisions/decision.ts';
import type { Explanation } from '../explanation/explanation.ts';
import type { FinancialState } from '../financial-state/financial-state.ts';
import type { IndicatorVariation, Indicators } from '../indicators/indicators.ts';
import type { Projection } from '../projection/projection.ts';

export interface SimulationRequest {
  /** Base state. Never modified: the scenario is derived as a new value (rule 3). */
  readonly state: FinancialState;
  /** Applied in order (HU07 allows several decisions per scenario). */
  readonly decisions: readonly DecisionInput[];
  /** Number of projected months (HU05: configurable; Calidad: 12 months under 300 ms p95). */
  readonly horizonMonths: number;
}

export interface ScenarioOutcome {
  readonly projection: Projection;
  readonly indicators: Indicators;
}

export interface SimulationResult {
  readonly base: ScenarioOutcome;
  readonly scenario: ScenarioOutcome;
  readonly variation: IndicatorVariation;
  readonly explanation: Explanation;
}

export type SimulationOutcome =
  | { readonly ok: true; readonly result: SimulationResult }
  | {
      readonly ok: false;
      /** Problems per decision, indexed like `request.decisions`. */
      readonly issues: readonly { readonly decisionIndex: number; readonly issues: readonly DecisionIssue[] }[];
    };

/**
 * Engine entry point: pure and deterministic (rule 1). Same request and catalog, same outcome.
 * Implemented test-first in the engine block that follows the project skeleton.
 */
export type Simulate = (request: SimulationRequest, catalog: DecisionCatalog) => SimulationOutcome;
