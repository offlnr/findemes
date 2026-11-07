import { describe, expect, it } from 'vitest';
import { yearMonth } from '../../calendar/year-month.ts';
import type { EntryId, FinancialState } from '../../financial-state/financial-state.ts';
import { clp } from '../../money/clp.ts';
import { project } from '../../projection/project.ts';
import type { DecisionContext, DecisionType } from '../decision.ts';
import { debtPrepayment } from './debt-prepayment.ts';
import { fixedExpenseChange } from './fixed-expense-change.ts';
import { incomeVariation } from './income-variation.ts';
import { oneOffExpense } from './one-off-expense.ts';
import { purchaseInInstallments } from './purchase-in-installments.ts';

const id = (value: string) => value as EntryId;
const jan = yearMonth(2027, 1);

/** 1.000.000 income, 600.000 rent, a debt of five 100.000 installments (jan..may). */
const state: FinancialState = Object.freeze({
  startMonth: jan,
  openingBalance: clp(0),
  incomes: Object.freeze([
    { id: id('salary'), label: 'Sueldo', amount: clp(1_000_000), schedule: { kind: 'monthly', from: jan, until: null } } as const,
  ]),
  expenses: Object.freeze([
    {
      id: id('rent'),
      label: 'Arriendo',
      nature: 'fixed',
      amount: clp(600_000),
      schedule: { kind: 'monthly', from: jan, until: null },
    } as const,
    {
      id: id('food'),
      label: 'Supermercado',
      nature: 'variable_estimate',
      amount: clp(200_000),
      schedule: { kind: 'monthly', from: jan, until: null },
    } as const,
  ]),
  debts: Object.freeze([
    {
      id: id('loan'),
      label: 'Crédito de consumo',
      installments: Object.freeze([1, 2, 3, 4, 5].map((m) => ({ month: yearMonth(2027, m), amount: clp(100_000) }))),
    },
  ]),
});

const context: DecisionContext = { decisionIndex: 0, entryId: (n) => id(`decision-0-${String(n)}`) };

/** Parses and applies a decision, failing the test with its issues if parsing fails. */
function applyDecision<P>(type: DecisionType<string, P>, raw: unknown, base: FinancialState = state) {
  const parsed = type.parseParams(raw, base);
  if (!parsed.ok) {
    throw new Error(`Unexpected issues: ${JSON.stringify(parsed.issues)}`);
  }
  return { next: type.apply(base, parsed.value, context), text: type.describe(parsed.value, base) };
}

function issueFields(type: DecisionType, raw: unknown): string[] {
  const parsed = type.parseParams(raw, state);
  return parsed.ok ? [] : parsed.issues.map((issue) => issue.field);
}

const flows = (s: FinancialState, months = 6) =>
  project(s, months).months.map((m) => ({ in: m.income, out: m.expenses, debt: m.debtPayments }));

describe('purchase_in_installments', () => {
  const raw = { label: 'Notebook', totalAmount: 1_000_000, installments: 3, startMonth: '2027-02' };

  it('adds one installment per month from the start month, giving the extra pesos to the first ones', () => {
    const { next } = applyDecision(purchaseInInstallments, raw);
    // 1.000.000 / 3 = 333.333 remainder 1 -> 333.334, 333.333, 333.333
    expect(flows(next, 5).map((m) => m.debt)).toEqual([100_000, 433_334, 433_333, 433_333, 100_000]);
  });

  it('describes the installment amounts and the last month, assuming the total includes interest', () => {
    const { text } = applyDecision(purchaseInInstallments, raw);
    expect(text).toBe(
      'Compra «Notebook» por $1.000.000 en 3 cuotas desde febrero de 2027: se agregan cuotas de $333.333 ' +
        '(la primera de $333.334) hasta abril de 2027. Se asume que el monto total ya incluye los intereses.',
    );
  });

  it('rejects totals smaller than the number of installments and installment counts out of range', () => {
    expect(issueFields(purchaseInInstallments, { ...raw, totalAmount: 2 })).toEqual(['totalAmount']);
    expect(issueFields(purchaseInInstallments, { ...raw, installments: 0 })).toEqual(['installments']);
    expect(issueFields(purchaseInInstallments, { ...raw, installments: 121 })).toEqual(['installments']);
  });

  it('rejects unknown fields, missing names and malformed months', () => {
    expect(issueFields(purchaseInInstallments, { ...raw, interestRate: 3 })).toEqual(['interestRate']);
    expect(issueFields(purchaseInInstallments, { ...raw, label: '  ' })).toEqual(['label']);
    expect(issueFields(purchaseInInstallments, { ...raw, startMonth: '2027-13' })).toEqual(['startMonth']);
    expect(issueFields(purchaseInInstallments, 'nope')).toEqual(['params']);
  });
});

describe('fixed_expense_change', () => {
  it('adds a new fixed expense in every month of a bounded range', () => {
    const { next, text } = applyDecision(fixedExpenseChange, {
      label: 'Gimnasio',
      targetExpenseId: null,
      amount: 30_000,
      range: { from: '2027-02', until: '2027-03' },
    });
    expect(flows(next, 4).map((m) => m.out)).toEqual([800_000, 830_000, 830_000, 800_000]);
    expect(text).toBe('Nuevo gasto fijo «Gimnasio» de $30.000 mensuales desde febrero de 2027 hasta marzo de 2027.');
  });

  it('changes the amount of an existing fixed expense only within the range', () => {
    const { next, text } = applyDecision(fixedExpenseChange, {
      targetExpenseId: 'rent',
      amount: 450_000,
      range: { from: '2027-03', until: null },
    });
    expect(flows(next, 4).map((m) => m.out)).toEqual([800_000, 800_000, 650_000, 650_000]);
    expect(text).toBe('El gasto fijo «Arriendo» pasa de $600.000 a $450.000 mensuales desde marzo de 2027, de forma permanente.');
  });

  it('only modifies fixed expenses that exist', () => {
    const change = { amount: 1, range: { from: '2027-01', until: null } };
    expect(issueFields(fixedExpenseChange, { ...change, targetExpenseId: 'ghost' })).toEqual(['targetExpenseId']);
    expect(issueFields(fixedExpenseChange, { ...change, targetExpenseId: 'food' })).toEqual(['targetExpenseId']);
  });

  it('requires a name and a positive amount for a new expense, and a coherent range', () => {
    const fields = issueFields(fixedExpenseChange, {
      targetExpenseId: null,
      amount: 0,
      range: { from: '2027-05', until: '2027-04' },
    });
    expect(fields).toEqual(['label', 'amount', 'range.until']);
  });
});

describe('one_off_expense', () => {
  it('adds an expense in a single month', () => {
    const { next, text } = applyDecision(oneOffExpense, { label: 'Reparación', amount: 250_000, month: '2027-02' });
    expect(flows(next, 3).map((m) => m.out)).toEqual([800_000, 1_050_000, 800_000]);
    expect(text).toBe('Gasto único «Reparación» de $250.000 en febrero de 2027.');
  });

  it('rejects negative amounts', () => {
    expect(issueFields(oneOffExpense, { label: 'x', amount: -5, month: '2027-02' })).toEqual(['amount']);
  });
});

describe('income_variation', () => {
  it('decreases the monthly income within the range when the amount is negative', () => {
    const { next, text } = applyDecision(incomeVariation, {
      label: 'Menos horas',
      amount: -150_000,
      range: { from: '2027-02', until: '2027-03' },
    });
    expect(flows(next, 4).map((m) => m.in)).toEqual([1_000_000, 850_000, 850_000, 1_000_000]);
    expect(text).toBe('Variación de ingreso «Menos horas»: el ingreso mensual disminuye en $150.000 desde febrero de 2027 hasta marzo de 2027.');
  });

  it('increases it when the amount is positive', () => {
    const { text } = applyDecision(incomeVariation, { label: 'Reajuste', amount: 50_000, range: { from: '2027-01', until: null } });
    expect(text).toBe('Variación de ingreso «Reajuste»: el ingreso mensual aumenta en $50.000 desde enero de 2027, de forma permanente.');
  });

  it('rejects a variation of zero', () => {
    expect(issueFields(incomeVariation, { label: 'x', amount: 0, range: { from: '2027-01', until: null } })).toEqual(['amount']);
  });
});

describe('debt_prepayment', () => {
  const base = { debtId: 'loan', amount: 250_000, month: '2027-02' };

  it('reduce_term (default): extinguishes whole installments from the last one and keeps the monthly installment', () => {
    const { next, text } = applyDecision(debtPrepayment, base);
    // Feb pays its own installment plus the prepayment; may and apr are extinguished, mar drops by 50.000.
    expect(flows(next, 6).map((m) => m.debt)).toEqual([100_000, 350_000, 50_000, 0, 0, 0]);
    expect(text).toBe(
      'Prepago de $250.000 a «Crédito de consumo» en febrero de 2027, con la modalidad «reducir plazo»: se extinguen ' +
        'cuotas desde la última y la cuota mensual se mantiene. La última cuota pasa de mayo de 2027 a marzo de 2027.',
    );
  });

  it('reduce_installment: spreads the prepayment over the remaining installments and keeps the term', () => {
    const { next, text } = applyDecision(debtPrepayment, { ...base, amount: 100_000, modality: 'reduce_installment' });
    // 100.000 over the 3 installments after february: 33.334, 33.333, 33.333
    expect(flows(next, 6).map((m) => m.debt)).toEqual([100_000, 200_000, 66_666, 66_667, 66_667, 0]);
    expect(text).toBe(
      'Prepago de $100.000 a «Crédito de consumo» en febrero de 2027, con la modalidad «reducir cuota»: el monto se ' +
        'reparte entre las cuotas restantes y el plazo se mantiene. La cuota pasa de $100.000 a $66.666.',
    );
  });

  it('never modifies the base state (rule 3)', () => {
    const before = JSON.stringify(state);
    applyDecision(debtPrepayment, base);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('only accepts amounts up to the pending balance after the application month', () => {
    // Pending after february: 3 x 100.000
    expect(issueFields(debtPrepayment, { ...base, amount: 300_001 })).toEqual(['amount']);
    expect(issueFields(debtPrepayment, { ...base, amount: 300_000 })).toEqual([]);
  });

  it('rejects unknown debts, months without later installments and unknown modalities', () => {
    expect(issueFields(debtPrepayment, { ...base, debtId: 'ghost' })).toEqual(['debtId']);
    expect(issueFields(debtPrepayment, { ...base, month: '2027-05' })).toEqual(['month']);
    expect(issueFields(debtPrepayment, { ...base, modality: 'pay_all' })).toEqual(['modality']);
  });
});
