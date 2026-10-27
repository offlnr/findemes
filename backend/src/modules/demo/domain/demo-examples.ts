import {
  addMonths,
  clp,
  type Debt,
  type EntryId,
  type Expense,
  type FinancialState,
  type Income,
  type YearMonth,
} from '../../../core/index.ts';

/**
 * Fictitious base states of the demo mode (HU27). They never come from a real person and every
 * result built on them is labeled as demonstration data. Amounts are plausible Chilean figures.
 */
export interface DemoExample {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

interface ExampleDefinition extends DemoExample {
  readonly openingBalance: number;
  readonly incomes: readonly { readonly id: string; readonly label: string; readonly amount: number }[];
  readonly expenses: readonly {
    readonly id: string;
    readonly label: string;
    readonly amount: number;
    readonly nature: Expense['nature'];
  }[];
  readonly debts: readonly {
    readonly id: string;
    readonly label: string;
    readonly installmentAmount: number;
    readonly remainingInstallments: number;
  }[];
}

const EXAMPLES: readonly ExampleDefinition[] = [
  {
    id: 'estudiante',
    name: 'Estudiante',
    description: 'Trabajo part-time, arriendo de una pieza y sin deudas.',
    openingBalance: 180_000,
    incomes: [{ id: 'sueldo', label: 'Sueldo part-time', amount: 420_000 }],
    expenses: [
      { id: 'arriendo', label: 'Arriendo de pieza', amount: 200_000, nature: 'fixed' },
      { id: 'gastos-variables', label: 'Alimentación y transporte', amount: 180_000, nature: 'variable_estimate' },
    ],
    debts: [],
  },
  {
    id: 'familia',
    name: 'Familia',
    description: 'Un ingreso familiar, arriendo, gastos del hogar y un crédito automotriz.',
    openingBalance: 612_340,
    incomes: [{ id: 'ingreso-familiar', label: 'Ingreso familiar', amount: 1_150_000 }],
    expenses: [
      { id: 'arriendo', label: 'Arriendo', amount: 450_000, nature: 'fixed' },
      { id: 'gastos-hogar', label: 'Supermercado y gastos del hogar', amount: 440_000, nature: 'variable_estimate' },
    ],
    debts: [{ id: 'credito-automotriz', label: 'Crédito automotriz', installmentAmount: 220_000, remainingInstallments: 10 }],
  },
  {
    id: 'profesional',
    name: 'Profesional con deudas',
    description: 'Sueldo estable, dividendo, un crédito de consumo y una compra en cuotas.',
    openingBalance: 950_000,
    incomes: [{ id: 'sueldo', label: 'Sueldo', amount: 2_100_000 }],
    expenses: [
      { id: 'dividendo', label: 'Dividendo', amount: 650_000, nature: 'fixed' },
      { id: 'gastos-hogar', label: 'Gastos del hogar', amount: 800_000, nature: 'variable_estimate' },
    ],
    debts: [
      { id: 'credito-consumo', label: 'Crédito de consumo', installmentAmount: 480_000, remainingInstallments: 18 },
      { id: 'tarjeta-cuotas', label: 'Compra en cuotas con tarjeta', installmentAmount: 300_000, remainingInstallments: 6 },
    ],
  },
];

export const DEMO_EXAMPLE_IDS = EXAMPLES.map((example) => example.id);

export function listDemoExamples(): readonly DemoExample[] {
  return EXAMPLES.map(({ id, name, description }) => ({ id, name, description }));
}

/** Builds the base state of an example starting at `startMonth`, or `undefined` if unknown. */
export function buildExampleState(exampleId: string, startMonth: YearMonth): FinancialState | undefined {
  const example = EXAMPLES.find((candidate) => candidate.id === exampleId);
  if (example === undefined) {
    return undefined;
  }
  const monthly = { kind: 'monthly' as const, from: startMonth, until: null };
  return {
    startMonth,
    openingBalance: clp(example.openingBalance),
    incomes: example.incomes.map(
      (income): Income => ({ id: income.id as EntryId, label: income.label, amount: clp(income.amount), schedule: monthly }),
    ),
    expenses: example.expenses.map(
      (expense): Expense => ({
        id: expense.id as EntryId,
        label: expense.label,
        nature: expense.nature,
        amount: clp(expense.amount),
        schedule: monthly,
      }),
    ),
    debts: example.debts.map(
      (debt): Debt => ({
        id: debt.id as EntryId,
        label: debt.label,
        installments: Array.from({ length: debt.remainingInstallments }, (_, index) => ({
          month: addMonths(startMonth, index),
          amount: clp(debt.installmentAmount),
        })),
      }),
    ),
  };
}

export const OWN_DATA_IDS = Object.freeze({ income: 'ingreso' as EntryId, fixedExpense: 'gasto-fijo' as EntryId });

/** Base state from the visitor's own minimal data (HU28): balance, one income, one fixed expense. */
export function buildOwnDataState(
  data: { readonly openingBalance: number; readonly monthlyIncome: number; readonly monthlyFixedExpense: number },
  startMonth: YearMonth,
): FinancialState {
  const monthly = { kind: 'monthly' as const, from: startMonth, until: null };
  return {
    startMonth,
    openingBalance: clp(data.openingBalance),
    incomes: [{ id: OWN_DATA_IDS.income, label: 'Ingreso mensual', amount: clp(data.monthlyIncome), schedule: monthly }],
    expenses: [
      { id: OWN_DATA_IDS.fixedExpense, label: 'Gasto fijo mensual', nature: 'fixed', amount: clp(data.monthlyFixedExpense), schedule: monthly },
    ],
    debts: [],
  };
}
