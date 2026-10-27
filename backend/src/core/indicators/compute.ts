import { clp } from '../money/clp.ts';
import type { Projection } from '../projection/projection.ts';
import type { IndicatorVariation, Indicators, MonthlyAmount, MonthlyRatio } from './indicators.ts';

const FULL_RATIO_BASIS_POINTS = 10_000;

/** Indicators of Tabla 12 for one projection. The projection must have at least one month. */
export function computeIndicators(projection: Projection): Indicators {
  const [first] = projection.months;
  if (first === undefined) {
    throw new RangeError('A projection needs at least one month');
  }

  let minimum = { amount: first.closingBalance, month: first.month };
  let breakMonth: Indicators['breakMonth'] = null;
  const monthlyAvailableMargin: MonthlyAmount[] = [];
  const debtToIncome: MonthlyRatio[] = [];

  for (const month of projection.months) {
    if (month.closingBalance < minimum.amount) {
      minimum = { amount: month.closingBalance, month: month.month };
    }
    if (breakMonth === null && month.closingBalance < 0) {
      breakMonth = month.month;
    }
    monthlyAvailableMargin.push({ month: month.month, amount: clp(month.income - month.expenses - month.debtPayments) });
    debtToIncome.push({
      month: month.month,
      basisPoints: month.income > 0 ? Math.round((month.debtPayments * FULL_RATIO_BASIS_POINTS) / month.income) : null,
    });
  }

  return {
    minimumProjectedBalance: minimum,
    breakMonth,
    monthlyAvailableMargin,
    debtToIncome,
  };
}

/**
 * "Variación respecto del escenario base": scenario minus base, month by month. Both indicator
 * sets come from projections with the same start month and horizon.
 */
export function computeVariation(base: Indicators, scenario: Indicators): IndicatorVariation {
  return {
    minimumProjectedBalance: clp(scenario.minimumProjectedBalance.amount - base.minimumProjectedBalance.amount),
    breakMonth: { base: base.breakMonth, scenario: scenario.breakMonth },
    monthlyAvailableMargin: scenario.monthlyAvailableMargin.map((entry, index) => ({
      month: entry.month,
      amount: clp(entry.amount - (base.monthlyAvailableMargin[index]?.amount ?? 0)),
    })),
    debtToIncome: scenario.debtToIncome.map((entry, index) => {
      const baseRatio = base.debtToIncome[index]?.basisPoints ?? null;
      return {
        month: entry.month,
        basisPoints: entry.basisPoints === null || baseRatio === null ? null : entry.basisPoints - baseRatio,
      };
    }),
  };
}
