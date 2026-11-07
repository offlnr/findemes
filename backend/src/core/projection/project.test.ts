import { describe, expect, it } from 'vitest';
import { yearMonth } from '../calendar/year-month.ts';
import type { EntryId, FinancialState } from '../financial-state/financial-state.ts';
import { clp } from '../money/clp.ts';
import { isScheduledIn, project } from './project.ts';

const id = (value: string) => value as EntryId;
const jan = yearMonth(2027, 1);

const state: FinancialState = {
  startMonth: jan,
  openingBalance: clp(100_000),
  incomes: [
    { id: id('salary'), label: 'Sueldo', amount: clp(1_000_000), schedule: { kind: 'monthly', from: jan, until: null } },
    { id: id('bonus'), label: 'Bono', amount: clp(300_000), schedule: { kind: 'once', month: yearMonth(2027, 3) } },
  ],
  expenses: [
    {
      id: id('rent'),
      label: 'Arriendo',
      nature: 'fixed',
      amount: clp(600_000),
      schedule: { kind: 'monthly', from: jan, until: null },
    },
    {
      id: id('food'),
      label: 'Supermercado',
      nature: 'variable_estimate',
      amount: clp(350_000),
      schedule: { kind: 'monthly', from: jan, until: yearMonth(2027, 2) },
    },
  ],
  debts: [
    {
      id: id('card'),
      label: 'Tarjeta',
      installments: [
        { month: yearMonth(2026, 12), amount: clp(99_999) },
        { month: jan, amount: clp(80_000) },
        { month: yearMonth(2027, 2), amount: clp(80_000) },
      ],
    },
  ],
};

describe('project', () => {
  it('chains each closing balance into the next month and itemizes the flows', () => {
    const { months } = project(state, 4);

    expect(months.map((m) => [m.openingBalance, m.income, m.expenses, m.debtPayments, m.netFlow, m.closingBalance])).toEqual([
      // jan: 100.000 + 1.000.000 - 950.000 - 80.000
      [100_000, 1_000_000, 950_000, 80_000, -30_000, 70_000],
      // feb: last month of the food estimate and of the debt
      [70_000, 1_000_000, 950_000, 80_000, -30_000, 40_000],
      // mar: one-off bonus, food and debt already ended
      [40_000, 1_300_000, 600_000, 0, 700_000, 740_000],
      [740_000, 1_000_000, 600_000, 0, 400_000, 1_140_000],
    ]);
    expect(months.map((m) => m.month)).toEqual([jan, yearMonth(2027, 2), yearMonth(2027, 3), yearMonth(2027, 4)]);
  });

  it('ignores installments dated before the first projected month', () => {
    const [first] = project(state, 1).months;
    expect(first?.debtPayments).toBe(80_000);
  });

  it('returns exactly the requested number of months', () => {
    expect(project(state, 12).months).toHaveLength(12);
  });

  it('rejects horizons that are not positive integers', () => {
    expect(() => project(state, 0)).toThrow(RangeError);
    expect(() => project(state, 2.5)).toThrow(RangeError);
  });
});

describe('isScheduledIn', () => {
  it('applies an every-n-months schedule only on its anchored months within the range', () => {
    const quarterly = { kind: 'every_n_months', intervalMonths: 3, from: jan, until: yearMonth(2027, 7) } as const;
    const hits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((m) => isScheduledIn(quarterly, yearMonth(2027, m)));
    expect(hits).toEqual([1, 4, 7]);
  });

  it('does not apply a schedule before its first month', () => {
    const quarterly = { kind: 'every_n_months', intervalMonths: 3, from: jan, until: null } as const;
    expect(isScheduledIn(quarterly, yearMonth(2026, 10))).toBe(false);
  });
});
