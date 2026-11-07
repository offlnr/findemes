import {
  formatYearMonth,
  type FinancialState,
  type IndicatorVariation,
  type Indicators,
  type ScenarioOutcome,
  type YearMonth,
} from '../../core/index.ts';

// JSON views of engine results: months travel as "YYYY-MM" strings and amounts as integer CLP.
// The schemas below document exactly these shapes in docs/openapi.yaml.

const month = (value: YearMonth) => formatYearMonth(value);
const optionalMonth = (value: YearMonth | null) => (value === null ? null : month(value));

export function indicatorsView(indicators: Indicators) {
  return {
    minimumProjectedBalance: {
      amount: indicators.minimumProjectedBalance.amount,
      month: month(indicators.minimumProjectedBalance.month),
    },
    breakMonth: optionalMonth(indicators.breakMonth),
    monthlyAvailableMargin: indicators.monthlyAvailableMargin.map((entry) => ({ month: month(entry.month), amount: entry.amount })),
    debtToIncome: indicators.debtToIncome.map((entry) => ({ month: month(entry.month), basisPoints: entry.basisPoints })),
  };
}

export function outcomeView(outcome: ScenarioOutcome) {
  return {
    months: outcome.projection.months.map((entry) => ({
      month: month(entry.month),
      openingBalance: entry.openingBalance,
      income: entry.income,
      expenses: entry.expenses,
      debtPayments: entry.debtPayments,
      netFlow: entry.netFlow,
      closingBalance: entry.closingBalance,
    })),
    indicators: indicatorsView(outcome.indicators),
  };
}

export function variationView(variation: IndicatorVariation) {
  return {
    minimumProjectedBalance: variation.minimumProjectedBalance,
    breakMonth: { base: optionalMonth(variation.breakMonth.base), scenario: optionalMonth(variation.breakMonth.scenario) },
    monthlyAvailableMargin: variation.monthlyAvailableMargin.map((entry) => ({ month: month(entry.month), amount: entry.amount })),
    debtToIncome: variation.debtToIncome.map((entry) => ({ month: month(entry.month), basisPoints: entry.basisPoints })),
  };
}

/** Entries of a base state with the ids a decision can refer to (target expense, debt). */
export function entriesView(state: FinancialState) {
  return {
    openingBalance: state.openingBalance,
    incomes: state.incomes.map((income) => ({ id: income.id, label: income.label, amount: income.amount })),
    expenses: state.expenses.map((expense) => ({ id: expense.id, label: expense.label, amount: expense.amount, nature: expense.nature })),
    debts: state.debts.map((debt) => ({
      id: debt.id,
      label: debt.label,
      installments: debt.installments.map((installment) => ({ month: month(installment.month), amount: installment.amount })),
    })),
  };
}

// ---- JSON Schemas (OpenAPI) ----

const amount = { type: 'integer' } as const;
const monthString = { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', examples: ['2026-11'] } as const;
const nullableMonth = { anyOf: [monthString, { type: 'null' }] } as const;

function strictObject(properties: Record<string, unknown>, description?: string) {
  return {
    type: 'object',
    ...(description === undefined ? {} : { description }),
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  } as const;
}

const monthlyAmounts = { type: 'array', items: strictObject({ month: monthString, amount }) } as const;
const monthlyRatios = {
  type: 'array',
  description: 'Puntos básicos enteros (10 000 = 100 %); null si el mes no tiene ingresos.',
  items: strictObject({ month: monthString, basisPoints: { anyOf: [{ type: 'integer' }, { type: 'null' }] } }),
} as const;

export const indicatorsSchema = strictObject(
  {
    minimumProjectedBalance: strictObject({ amount, month: monthString }, 'Saldo mínimo proyectado y primer mes en que ocurre.'),
    breakMonth: { ...nullableMonth, description: 'Primer mes con saldo negativo; null si no ocurre.' },
    monthlyAvailableMargin: { ...monthlyAmounts, description: 'Ingresos menos compromisos totales de cada mes.' },
    debtToIncome: monthlyRatios,
  },
  'Indicadores de la Tabla 12.',
);

export const outcomeSchema = strictObject({
  months: {
    type: 'array',
    items: strictObject({
      month: monthString,
      openingBalance: amount,
      income: amount,
      expenses: amount,
      debtPayments: amount,
      netFlow: amount,
      closingBalance: amount,
    }),
  },
  indicators: indicatorsSchema,
});

export const variationSchema = strictObject(
  {
    minimumProjectedBalance: amount,
    breakMonth: strictObject({ base: nullableMonth, scenario: nullableMonth }),
    monthlyAvailableMargin: monthlyAmounts,
    debtToIncome: monthlyRatios,
  },
  'Diferencia de cada indicador: escenario menos base. No indica qué resultado es preferible.',
);

export const explanationSchema = strictObject({ summary: { type: 'string' }, details: { type: 'array', items: { type: 'string' } } });

export const entriesSchema = strictObject({
  openingBalance: amount,
  incomes: { type: 'array', items: strictObject({ id: { type: 'string' }, label: { type: 'string' }, amount }) },
  expenses: {
    type: 'array',
    items: strictObject({ id: { type: 'string' }, label: { type: 'string' }, amount, nature: { type: 'string', enum: ['fixed', 'variable_estimate'] } }),
  },
  debts: {
    type: 'array',
    items: strictObject({
      id: { type: 'string' },
      label: { type: 'string' },
      installments: { type: 'array', items: strictObject({ month: monthString, amount }) },
    }),
  },
});

export const decisionIssueSchema = strictObject({ field: { type: 'string' }, message: { type: 'string' } });
