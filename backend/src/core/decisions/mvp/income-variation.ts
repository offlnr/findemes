import { clp } from '../../money/clp.ts';
import { formatClpEs } from '../../text/spanish.ts';
import type { IncomeVariationParams } from '../catalog-params.ts';
import type { DecisionType } from '../decision.ts';
import { ParamsReader } from '../params-reader.ts';
import { describeRange } from './range-text.ts';

/** "Variación de ingreso" (Tabla 11): a signed adjustment of the monthly income within a range. */
export const incomeVariation: DecisionType<'income_variation', IncomeVariationParams> = {
  kind: 'income_variation',

  parseParams(raw) {
    const reader = ParamsReader.open(raw, ['label', 'amount', 'range']);
    const label = reader.label('label');
    const amount = reader.amount('amount', 'non_zero');
    const range = reader.range('range');
    if (label === undefined || amount === undefined || range === undefined || reader.issues.length > 0) {
      return reader.failure();
    }
    return { ok: true, value: { label, amount, range } };
  },

  apply(state, params, context) {
    return {
      ...state,
      incomes: [
        ...state.incomes,
        {
          id: context.entryId(0),
          label: params.label,
          amount: params.amount,
          schedule: { kind: 'monthly', from: params.range.from, until: params.range.until },
        },
      ],
    };
  },

  describe(params) {
    const direction = params.amount > 0 ? 'aumenta' : 'disminuye';
    return (
      `Variación de ingreso «${params.label}»: el ingreso mensual ${direction} en ` +
      `${formatClpEs(clp(Math.abs(params.amount)))} ${describeRange(params.range)}.`
    );
  },
};
