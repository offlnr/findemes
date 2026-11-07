import { describe, expect, it } from 'vitest';
import { yearMonth, type YearMonth } from '../calendar/year-month.ts';
import { clp } from '../money/clp.ts';
import type { ProjectedMonth, Projection } from '../projection/projection.ts';
import { computeIndicators, computeVariation } from './compute.ts';

function month(at: YearMonth, opening: number, income: number, expenses: number, debt: number): ProjectedMonth {
  const net = income - expenses - debt;
  return {
    month: at,
    openingBalance: clp(opening),
    income: clp(income),
    expenses: clp(expenses),
    debtPayments: clp(debt),
    netFlow: clp(net),
    closingBalance: clp(opening + net),
  };
}

const jan = yearMonth(2027, 1);
const feb = yearMonth(2027, 2);
const mar = yearMonth(2027, 3);

const base: Projection = {
  months: [month(jan, 50_000, 1_000_000, 900_000, 200_000), month(feb, -50_000, 1_000_000, 900_000, 0), month(mar, 50_000, 0, 0, 30_000)],
};

describe('computeIndicators', () => {
  const indicators = computeIndicators(base);

  it('finds the lowest closing balance and the first month it occurs', () => {
    expect(indicators.minimumProjectedBalance).toEqual({ amount: -50_000, month: jan });
  });

  it('marks the first month whose closing balance is negative as the break month', () => {
    expect(indicators.breakMonth).toEqual(jan);
  });

  it('computes the monthly available margin as income minus all commitments', () => {
    expect(indicators.monthlyAvailableMargin.map((m) => m.amount)).toEqual([-100_000, 100_000, -30_000]);
  });

  it('expresses debt-to-income in basis points and leaves it undefined without income', () => {
    expect(indicators.debtToIncome.map((m) => m.basisPoints)).toEqual([2_000, 0, null]);
  });

  it('rounds the ratio to the nearest basis point', () => {
    const odd = computeIndicators({ months: [month(jan, 0, 3_000_000, 0, 1_000_000)] });
    // 1/3 = 3333,33... bp
    expect(odd.debtToIncome[0]?.basisPoints).toBe(3_333);
  });

  it('reports no break month when the balance never goes below zero', () => {
    const healthy = computeIndicators({ months: [month(jan, 0, 100, 100, 0)] });
    expect(healthy.breakMonth).toBeNull();
    expect(healthy.minimumProjectedBalance).toEqual({ amount: 0, month: jan });
  });
});

describe('computeVariation', () => {
  it('subtracts the base from the scenario for every indicator, without judging the sign', () => {
    const scenario: Projection = {
      months: [month(jan, 50_000, 1_000_000, 900_000, 250_000), month(feb, -100_000, 1_000_000, 900_000, 0), month(mar, 0, 0, 0, 30_000)],
    };
    const variation = computeVariation(computeIndicators(base), computeIndicators(scenario));

    expect(variation.minimumProjectedBalance).toBe(-50_000);
    expect(variation.breakMonth).toEqual({ base: jan, scenario: jan });
    expect(variation.monthlyAvailableMargin.map((m) => m.amount)).toEqual([-50_000, 0, 0]);
    expect(variation.debtToIncome.map((m) => m.basisPoints)).toEqual([500, 0, null]);
  });
});
