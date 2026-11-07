import { formatClpEs, formatMonthEs } from '../../text/spanish.ts';
import type { OneOffExpenseParams } from '../catalog-params.ts';
import type { DecisionType } from '../decision.ts';
import { ParamsReader } from '../params-reader.ts';

/** "Gasto único" (Tabla 11): one expense in a single month. */
export const oneOffExpense: DecisionType<'one_off_expense', OneOffExpenseParams> = {
  kind: 'one_off_expense',

  parseParams(raw) {
    const reader = ParamsReader.open(raw, ['label', 'amount', 'month']);
    const label = reader.label('label');
    const amount = reader.amount('amount', 'positive');
    const month = reader.month('month');
    if (label === undefined || amount === undefined || month === undefined || reader.issues.length > 0) {
      return reader.failure();
    }
    return { ok: true, value: { label, amount, month } };
  },

  apply(state, params, context) {
    return {
      ...state,
      expenses: [
        ...state.expenses,
        { id: context.entryId(0), label: params.label, nature: 'variable_estimate', amount: params.amount, schedule: { kind: 'once', month: params.month } },
      ],
    };
  },

  describe(params) {
    return `Gasto único «${params.label}» de ${formatClpEs(params.amount)} en ${formatMonthEs(params.month)}.`;
  },
};
