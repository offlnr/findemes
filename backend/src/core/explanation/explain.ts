import { compareYearMonth, type YearMonth } from '../calendar/year-month.ts';
import type { IndicatorVariation, Indicators } from '../indicators/indicators.ts';
import { clp, type Clp } from '../money/clp.ts';
import type { Projection } from '../projection/projection.ts';
import { formatClpEs, formatMonthEs, formatSignedClpEs } from '../text/spanish.ts';
import type { Explanation } from './explanation.ts';

interface Outcome {
  readonly projection: Projection;
  readonly indicators: Indicators;
}

export interface ExplanationInput {
  readonly base: Outcome;
  readonly scenario: Outcome;
  readonly variation: IndicatorVariation;
  /** `describe()` of each applied decision, in application order. */
  readonly decisionTexts: readonly string[];
  /** Change in the minimum projected balance caused by each decision, applied cumulatively. */
  readonly decisionEffects: readonly Clp[];
}

/** "En marzo de 2027 ingresan $X y salen $Y en gastos y $Z en cuotas; el mes comienza con $W." */
function describeMonth(projection: Projection, month: YearMonth): string {
  const detail = projection.months.find((entry) => compareYearMonth(entry.month, month) === 0);
  if (detail === undefined) {
    return '';
  }
  return (
    `En ${formatMonthEs(month)} ingresan ${formatClpEs(detail.income)} y salen ${formatClpEs(detail.expenses)} en gastos ` +
    `y ${formatClpEs(detail.debtPayments)} en cuotas; el mes comienza con ${formatClpEs(detail.openingBalance)} ` +
    `y cierra con ${formatClpEs(detail.closingBalance)}.`
  );
}

function describeBaseOnly(outcome: Outcome): Explanation {
  const { breakMonth, minimumProjectedBalance: minimum } = outcome.indicators;
  if (breakMonth !== null) {
    return {
      summary: `El saldo proyectado pasa a ser negativo en ${formatMonthEs(breakMonth)}: los egresos acumulados superan a los ingresos y al saldo inicial.`,
      details: [describeMonth(outcome.projection, breakMonth)],
    };
  }
  return {
    summary: `El saldo proyectado se mantiene en cero o más durante todo el horizonte; el menor saldo es ${formatClpEs(minimum.amount)} en ${formatMonthEs(minimum.month)}.`,
    details: [describeMonth(outcome.projection, minimum.month)],
  };
}

function describeBreakChange(base: YearMonth | null, scenario: YearMonth | null, without: string): string {
  if (base === null) {
    return scenario === null
      ? `El saldo no pasa a ser negativo en el horizonte, ni con ni ${without}.`
      : `El saldo pasa a ser negativo en ${formatMonthEs(scenario)}; ${without} se mantiene en cero o más durante el horizonte.`;
  }
  if (scenario === null) {
    return `El saldo se mantiene en cero o más durante el horizonte; ${without} pasa a ser negativo en ${formatMonthEs(base)}.`;
  }
  return compareYearMonth(base, scenario) === 0
    ? `El mes de quiebre se mantiene en ${formatMonthEs(scenario)}.`
    : `El mes de quiebre pasa de ${formatMonthEs(base)} a ${formatMonthEs(scenario)}.`;
}

/**
 * Deterministic explanation (HU10) built only from the computed figures, so it is always
 * consistent with them. Descriptive by construction: every sentence states a figure, a month
 * or an applied assumption; none ranks, judges or suggests (rule 4).
 */
export function explain(input: ExplanationInput): Explanation {
  const count = input.decisionTexts.length;
  if (count === 0) {
    return describeBaseOnly(input.scenario);
  }

  const scenarioMin = input.scenario.indicators.minimumProjectedBalance;
  const baseMin = input.base.indicators.minimumProjectedBalance;
  const applied = count === 1 ? 'la decisión aplicada' : `las ${String(count)} decisiones aplicadas`;
  const without = count === 1 ? 'sin ella' : 'sin ellas';
  const difference = input.variation.minimumProjectedBalance;
  const comparison =
    difference === 0
      ? `igual que ${without}`
      : `frente a ${formatClpEs(baseMin.amount)} ${without} (${formatSignedClpEs(difference)})`;

  const details = [...input.decisionTexts];
  details.push(describeBreakChange(input.variation.breakMonth.base, input.variation.breakMonth.scenario, without));
  details.push(describeMonth(input.scenario.projection, scenarioMin.month));

  if (count > 1) {
    let dominant = -1;
    input.decisionEffects.forEach((effect, index) => {
      if (effect !== 0 && (dominant < 0 || Math.abs(effect) > Math.abs(input.decisionEffects[dominant] ?? clp(0)))) {
        dominant = index;
      }
    });
    const effect = input.decisionEffects[dominant];
    if (effect !== undefined) {
      details.push(
        `La decisión que más modifica el saldo mínimo es la número ${String(dominant + 1)}, con una diferencia de ${formatSignedClpEs(effect)}.`,
      );
    }
  }

  return {
    summary: `Con ${applied}, el saldo mínimo proyectado es ${formatClpEs(scenarioMin.amount)} en ${formatMonthEs(scenarioMin.month)}, ${comparison}.`,
    details,
  };
}
