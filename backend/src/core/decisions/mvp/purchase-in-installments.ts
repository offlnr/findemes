import { addMonths } from '../../calendar/year-month.ts';
import { clp, type Clp } from '../../money/clp.ts';
import { formatClpEs, formatMonthEs } from '../../text/spanish.ts';
import type { PurchaseInInstallmentsParams } from '../catalog-params.ts';
import type { DecisionType } from '../decision.ts';
import { ParamsReader } from '../params-reader.ts';

export const MAX_INSTALLMENTS = 120;

/** Splits a total into `count` whole-peso installments; the first ones absorb the remainder. */
export function splitIntoInstallments(total: Clp, count: number): Clp[] {
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) => clp(index < remainder ? base + 1 : base));
}

/** "Compra en N cuotas" (Tabla 11): modeled as a new debt with N monthly installments. */
export const purchaseInInstallments: DecisionType<'purchase_in_installments', PurchaseInInstallmentsParams> = {
  kind: 'purchase_in_installments',

  parseParams(raw) {
    const reader = ParamsReader.open(raw, ['label', 'totalAmount', 'installments', 'startMonth']);
    const label = reader.label('label');
    const totalAmount = reader.amount('totalAmount', 'positive');
    const installments = reader.integer('installments', 1, MAX_INSTALLMENTS);
    const startMonth = reader.month('startMonth');
    if (totalAmount !== undefined && installments !== undefined && totalAmount < installments) {
      reader.fail('totalAmount', 'El monto total debe alcanzar al menos $1 por cuota.');
    }
    if (label === undefined || totalAmount === undefined || installments === undefined || startMonth === undefined || reader.issues.length > 0) {
      return reader.failure();
    }
    return { ok: true, value: { label, totalAmount, installments, startMonth } };
  },

  apply(state, params, context) {
    const amounts = splitIntoInstallments(params.totalAmount, params.installments);
    const debt = {
      id: context.entryId(0),
      label: params.label,
      installments: amounts.map((amount, index) => ({ month: addMonths(params.startMonth, index), amount })),
    };
    return { ...state, debts: [...state.debts, debt] };
  },

  describe(params) {
    const amounts = splitIntoInstallments(params.totalAmount, params.installments);
    const regular = amounts[amounts.length - 1] ?? params.totalAmount;
    const extra = amounts.filter((amount) => amount !== regular).length;
    const last = addMonths(params.startMonth, params.installments - 1);
    const plural = params.installments === 1 ? 'cuota' : 'cuotas';
    const extraText =
      extra === 0 ? '' : extra === 1 ? ` (la primera de ${formatClpEs(clp(regular + 1))})` : ` (las primeras ${String(extra)} de ${formatClpEs(clp(regular + 1))})`;
    return (
      `Compra «${params.label}» por ${formatClpEs(params.totalAmount)} en ${String(params.installments)} ${plural} ` +
      `desde ${formatMonthEs(params.startMonth)}: ${params.installments === 1 ? 'se agrega una cuota' : 'se agregan cuotas'} ` +
      `de ${formatClpEs(regular)}${extraText} ` +
      `hasta ${formatMonthEs(last)}. Se asume que el monto total ya incluye los intereses.`
    );
  },
};
