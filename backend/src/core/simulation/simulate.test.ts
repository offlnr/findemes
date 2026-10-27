import { describe, expect, it } from 'vitest';
import { yearMonth } from '../calendar/year-month.ts';
import { createDecisionCatalog } from '../decisions/catalog.ts';
import type { DecisionType } from '../decisions/decision.ts';
import { createMvpCatalog, MVP_DECISION_TYPES } from '../decisions/mvp/mvp-catalog.ts';
import type { EntryId, FinancialState } from '../financial-state/financial-state.ts';
import { clp } from '../money/clp.ts';
import { simulate } from './simulate.ts';

const id = (value: string) => value as EntryId;
const jan = yearMonth(2027, 1);
const catalog = createMvpCatalog();

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Balanced budget: each month nets to zero, so the balance stays at the opening 200.000. */
const state: FinancialState = deepFreeze({
  startMonth: jan,
  openingBalance: clp(200_000),
  incomes: [{ id: id('salary'), label: 'Sueldo', amount: clp(1_000_000), schedule: { kind: 'monthly', from: jan, until: null } }],
  expenses: [
    { id: id('rent'), label: 'Arriendo', nature: 'fixed', amount: clp(700_000), schedule: { kind: 'monthly', from: jan, until: null } },
    { id: id('food'), label: 'Supermercado', nature: 'variable_estimate', amount: clp(300_000), schedule: { kind: 'monthly', from: jan, until: null } },
  ],
  debts: [],
});

const repair = { kind: 'one_off_expense', params: { label: 'Reparación', amount: 500_000, month: '2027-03' } };
const raise = { kind: 'income_variation', params: { label: 'Reajuste', amount: 50_000, range: { from: '2027-01', until: null } } };

function run(decisions: { kind: string; params: unknown }[], horizonMonths = 6) {
  const outcome = simulate({ state, decisions, horizonMonths }, catalog);
  if (!outcome.ok) {
    throw new Error(JSON.stringify(outcome.issues));
  }
  return outcome.result;
}

describe('simulate', () => {
  it('projects the scenario next to the unchanged base and reports the neutral variation', () => {
    const result = run([repair]);

    expect(result.base.indicators.minimumProjectedBalance).toEqual({ amount: 200_000, month: jan });
    expect(result.base.indicators.breakMonth).toBeNull();
    expect(result.scenario.indicators.minimumProjectedBalance).toEqual({ amount: -300_000, month: yearMonth(2027, 3) });
    expect(result.scenario.indicators.breakMonth).toEqual(yearMonth(2027, 3));
    expect(result.variation.minimumProjectedBalance).toBe(-500_000);
    expect(result.variation.monthlyAvailableMargin.map((m) => m.amount)).toEqual([0, 0, -500_000, 0, 0, 0]);
  });

  it('explains the result with the figures it shows and the cause', () => {
    const { explanation } = run([repair]);

    expect(explanation.summary).toBe(
      'Con la decisión aplicada, el saldo mínimo proyectado es -$300.000 en marzo de 2027, frente a $200.000 sin ella (-$500.000).',
    );
    expect(explanation.details).toEqual([
      'Gasto único «Reparación» de $500.000 en marzo de 2027.',
      'El saldo pasa a ser negativo en marzo de 2027; sin ella se mantiene en cero o más durante el horizonte.',
      'En marzo de 2027 ingresan $1.000.000 y salen $1.500.000 en gastos y $0 en cuotas; el mes comienza con $200.000 y cierra con -$300.000.',
    ]);
  });

  it('names the decision with the largest effect on the minimum balance when several are applied', () => {
    const { explanation } = run([raise, repair]);
    // The raise adds 50.000 a month: by march the balance is 350.000 - 500.000 = -150.000.
    expect(explanation.summary).toBe(
      'Con las 2 decisiones aplicadas, el saldo mínimo proyectado es -$150.000 en marzo de 2027, frente a $200.000 sin ellas (-$350.000).',
    );
    expect(explanation.details.at(-1)).toBe('La decisión que más modifica el saldo mínimo es la número 2, con una diferencia de -$400.000.');
  });

  it('describes the base situation when no decision is applied', () => {
    const { explanation, variation } = run([]);
    expect(variation.minimumProjectedBalance).toBe(0);
    expect(explanation.summary).toBe(
      'El saldo proyectado se mantiene en cero o más durante todo el horizonte; el menor saldo es $200.000 en enero de 2027.',
    );
  });

  it('lets a later decision refer to an entry added by an earlier one', () => {
    const purchase = { kind: 'purchase_in_installments', params: { label: 'Bicicleta', totalAmount: 600_000, installments: 6, startMonth: '2027-01' } };
    const prepay = { kind: 'debt_prepayment', params: { debtId: 'decision-0-0', amount: 200_000, month: '2027-02' } };
    const result = run([purchase, prepay]);
    expect(result.scenario.projection.months.map((m) => m.debtPayments)).toEqual([100_000, 300_000, 100_000, 100_000, 0, 0]);
  });

  it('never modifies the base state (rule 3) and returns the same result for the same input (rule 1)', () => {
    const before = JSON.stringify(state);
    const first = run([raise, repair]);
    expect(JSON.stringify(state)).toBe(before);
    expect(run([raise, repair])).toEqual(first);
  });

  it('reports the issues of every invalid decision by its position, without projecting', () => {
    const outcome = simulate(
      { state, decisions: [repair, { kind: 'lottery_win', params: {} }, { kind: 'one_off_expense', params: { label: 'x', amount: 0, month: '2027-01' } }], horizonMonths: 6 },
      catalog,
    );
    expect(outcome).toEqual({
      ok: false,
      issues: [
        { decisionIndex: 1, issues: [{ field: 'kind', message: 'Tipo de decisión no reconocido.' }] },
        { decisionIndex: 2, issues: [{ field: 'amount', message: 'El monto debe ser mayor que cero.' }] },
      ],
    });
  });

  it('never recommends or judges in its explanations (rule 4)', () => {
    const decisions = [
      [repair],
      [raise],
      [raise, repair],
      [{ kind: 'fixed_expense_change', params: { targetExpenseId: 'rent', amount: 900_000, range: { from: '2027-02', until: null } } }],
      [],
    ];
    const banned = /deber[íi]a|recomend|conviene|sugerimos|mejor|peor|mejora|empeora|buen[ao]|mal[ao]\b|riesg|alerta/i;
    for (const set of decisions) {
      const { explanation } = run(set);
      for (const sentence of [explanation.summary, ...explanation.details]) {
        expect(sentence).not.toMatch(banned);
      }
    }
  });

  it('accepts a new decision type registered in a catalog without changing the engine (RNF17)', () => {
    const withdrawal: DecisionType<'savings_withdrawal', { amount: number }> = {
      kind: 'savings_withdrawal',
      parseParams: (raw) => ({ ok: true, value: raw as { amount: number } }),
      apply: (s, params) => ({ ...s, openingBalance: clp(s.openingBalance + params.amount) }),
      describe: (params) => `Retiro de ahorro de ${String(params.amount)} pesos.`,
    };
    const extended = createDecisionCatalog([...MVP_DECISION_TYPES, withdrawal]);
    const outcome = simulate({ state, decisions: [{ kind: 'savings_withdrawal', params: { amount: 100_000 } }], horizonMonths: 3 }, extended);
    expect(outcome.ok && outcome.result.variation.minimumProjectedBalance).toBe(100_000);
  });

  it('projects twelve months in well under 300 ms at the 95th percentile', () => {
    const large: FinancialState = {
      ...state,
      expenses: Array.from({ length: 60 }, (_, n) => ({
        id: id(`e${String(n)}`),
        label: `Gasto ${String(n)}`,
        nature: 'fixed' as const,
        amount: clp(1_000 + n),
        schedule: { kind: 'monthly' as const, from: jan, until: null },
      })),
      debts: Array.from({ length: 20 }, (_, n) => ({
        id: id(`d${String(n)}`),
        label: `Deuda ${String(n)}`,
        installments: Array.from({ length: 24 }, (_, m) => ({ month: yearMonth(2027 + Math.floor(m / 12), (m % 12) + 1), amount: clp(10_000) })),
      })),
    };
    const durations: number[] = [];
    for (let i = 0; i < 100; i++) {
      const started = performance.now();
      simulate({ state: large, decisions: [raise, repair, repair, raise, repair], horizonMonths: 12 }, catalog);
      durations.push(performance.now() - started);
    }
    durations.sort((a, b) => a - b);
    expect(durations[94]).toBeLessThan(300);
  });

  it('rejects an invalid horizon', () => {
    expect(() => simulate({ state, decisions: [], horizonMonths: 0 }, catalog)).toThrow(RangeError);
  });
});
