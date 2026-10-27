import { describe, expect, it } from 'vitest';
import { yearMonth } from '../calendar/year-month.ts';
import { createMvpCatalog } from '../decisions/mvp/mvp-catalog.ts';
import type { EntryId, FinancialState } from '../financial-state/financial-state.ts';
import { clp } from '../money/clp.ts';
import { simulate } from '../simulation/simulate.ts';

const id = (value: string) => value as EntryId;
const jan = yearMonth(2027, 1);

/** Loses 100.000 a month from 250.000: the balance turns negative in march. */
const deficit: FinancialState = {
  startMonth: jan,
  openingBalance: clp(250_000),
  incomes: [{ id: id('salary'), label: 'Sueldo', amount: clp(900_000), schedule: { kind: 'monthly', from: jan, until: null } }],
  expenses: [{ id: id('rent'), label: 'Arriendo', nature: 'fixed', amount: clp(1_000_000), schedule: { kind: 'monthly', from: jan, until: null } }],
  debts: [],
};

function explanationFor(decisions: { kind: string; params: unknown }[]) {
  const outcome = simulate({ state: deficit, decisions, horizonMonths: 6 }, createMvpCatalog());
  if (!outcome.ok) {
    throw new Error(JSON.stringify(outcome.issues));
  }
  return outcome.result.explanation;
}

const income = (amount: number) => ({ kind: 'income_variation', params: { label: 'Ingreso extra', amount, range: { from: '2027-01', until: null } } });

describe('explain', () => {
  it('names the break month of the base situation and what happens that month', () => {
    expect(explanationFor([])).toEqual({
      summary: 'El saldo proyectado pasa a ser negativo en marzo de 2027: los egresos acumulados superan a los ingresos y al saldo inicial.',
      details: ['En marzo de 2027 ingresan $900.000 y salen $1.000.000 en gastos y $0 en cuotas; el mes comienza con $50.000 y cierra con -$50.000.'],
    });
  });

  it('states when a decision removes the break month, without judging it', () => {
    expect(explanationFor([income(100_000)]).details[1]).toBe(
      'El saldo se mantiene en cero o más durante el horizonte; sin ella pasa a ser negativo en marzo de 2027.',
    );
  });

  it('states when the break month moves or stays', () => {
    expect(explanationFor([income(50_000)]).details[1]).toBe('El mes de quiebre pasa de marzo de 2027 a junio de 2027.');
    expect(explanationFor([income(1)]).details[1]).toBe('El mes de quiebre se mantiene en marzo de 2027.');
  });

  it('says so when the decisions leave the minimum balance unchanged', () => {
    const later = { kind: 'one_off_expense', params: { label: 'Fuera del horizonte', amount: 1_000, month: '2028-01' } };
    expect(explanationFor([later]).summary).toBe(
      'Con la decisión aplicada, el saldo mínimo proyectado es -$350.000 en junio de 2027, igual que sin ella.',
    );
  });
});
