import type { DecisionCatalog } from '../decisions/catalog.ts';
import type { DecisionIssue } from '../decisions/decision.ts';
import type { EntryId, FinancialState } from '../financial-state/financial-state.ts';
import { explain } from '../explanation/explain.ts';
import { computeIndicators, computeVariation } from '../indicators/compute.ts';
import { clp, type Clp } from '../money/clp.ts';
import { project } from '../projection/project.ts';
import type { ScenarioOutcome, Simulate } from './simulation.ts';

function outcomeOf(state: FinancialState, horizonMonths: number): ScenarioOutcome {
  const projection = project(state, horizonMonths);
  return { projection, indicators: computeIndicators(projection) };
}

/**
 * Engine entry point (rule 1): pure and deterministic. Decisions are validated and applied in
 * order, each against the state left by the previous ones, so a later decision can refer to an
 * entry an earlier one added (e.g. prepaying a purchase in installments). The base state is
 * never modified (rule 3). Throws RangeError only for an invalid horizon (a caller bug).
 */
export const simulate: Simulate = (request, catalog: DecisionCatalog) => {
  const base = outcomeOf(request.state, request.horizonMonths);

  let state = request.state;
  const issues: { decisionIndex: number; issues: readonly DecisionIssue[] }[] = [];
  const decisionTexts: string[] = [];
  const decisionEffects: Clp[] = [];
  let previousMinimum = base.indicators.minimumProjectedBalance.amount;

  request.decisions.forEach((decision, decisionIndex) => {
    const type = catalog.get(decision.kind);
    if (type === undefined) {
      issues.push({ decisionIndex, issues: [{ field: 'kind', message: 'Tipo de decisión no reconocido.' }] });
      return;
    }
    const parsed = type.parseParams(decision.params, state);
    if (!parsed.ok) {
      issues.push({ decisionIndex, issues: parsed.issues });
      return;
    }
    decisionTexts.push(type.describe(parsed.value, state));
    state = type.apply(state, parsed.value, {
      decisionIndex,
      entryId: (n) => `decision-${String(decisionIndex)}-${String(n)}` as EntryId,
    });
    const minimum = outcomeOf(state, request.horizonMonths).indicators.minimumProjectedBalance.amount;
    decisionEffects.push(clp(minimum - previousMinimum));
    previousMinimum = minimum;
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const scenario = request.decisions.length === 0 ? base : outcomeOf(state, request.horizonMonths);
  const variation = computeVariation(base.indicators, scenario.indicators);
  return {
    ok: true,
    result: {
      base,
      scenario,
      variation,
      explanation: explain({ base, scenario, variation, decisionTexts, decisionEffects }),
    },
  };
};
