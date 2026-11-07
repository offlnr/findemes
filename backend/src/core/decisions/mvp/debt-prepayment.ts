import { compareYearMonth } from '../../calendar/year-month.ts';
import type { Debt, EntryId, FinancialState, Installment } from '../../financial-state/financial-state.ts';
import { clp } from '../../money/clp.ts';
import { formatClpEs, formatMonthEs } from '../../text/spanish.ts';
import type { DebtPrepaymentParams, PrepaymentModality } from '../catalog-params.ts';
import type { DecisionType } from '../decision.ts';
import { ParamsReader } from '../params-reader.ts';

const MODALITIES: readonly PrepaymentModality[] = ['reduce_term', 'reduce_installment'];

const MODALITY_TEXT: Readonly<Record<PrepaymentModality, string>> = {
  reduce_term: 'con la modalidad «reducir plazo»: se extinguen cuotas desde la última y la cuota mensual se mantiene',
  reduce_installment: 'con la modalidad «reducir cuota»: el monto se reparte entre las cuotas restantes y el plazo se mantiene',
};

function findDebt(state: FinancialState, id: EntryId): Debt | undefined {
  return state.debts.find((debt) => debt.id === id);
}

/** Installments after the application month: the ones a prepayment can reduce. */
function pendingAfter(debt: Debt, params: Pick<DebtPrepaymentParams, 'month'>): Installment[] {
  return debt.installments.filter((installment) => compareYearMonth(installment.month, params.month) > 0);
}

/**
 * New amounts of the pending installments after the prepayment (zero = extinguished).
 * - reduce_term: covers whole installments starting from the last one; a partial remainder
 *   lowers the installment where the prepayment runs out.
 * - reduce_installment: splits the prepayment in proportion to each installment (equal
 *   installments get equal reductions); leftover pesos go to the first installments.
 */
function reducedAmounts(pending: readonly Installment[], amount: number, modality: PrepaymentModality): number[] {
  if (modality === 'reduce_term') {
    let left = amount;
    return pending
      .map((installment) => installment.amount)
      .reverse()
      .map((value) => {
        const covered = Math.min(value, left);
        left -= covered;
        return value - covered;
      })
      .reverse();
  }

  // BigInt keeps amount * installment exact beyond 2^53 for large debts.
  const total = pending.reduce((sum, installment) => sum + BigInt(installment.amount), 0n);
  const shares = pending.map((installment) => Number((BigInt(amount) * BigInt(installment.amount)) / total));
  let leftover = amount - shares.reduce((sum, share) => sum + share, 0);
  return pending.map((installment, index) => {
    const extra = leftover > 0 && (shares[index] ?? 0) < installment.amount ? 1 : 0;
    leftover -= extra;
    return installment.amount - (shares[index] ?? 0) - extra;
  });
}

/**
 * "Adelanto o prepago de deuda" (Tabla 11). The app never pays debts: it simulates the effect
 * under the modality the user chooses, since the real rule depends on the institution.
 * The prepayment itself is an extra installment of the same debt in the application month.
 */
export const debtPrepayment: DecisionType<'debt_prepayment', DebtPrepaymentParams> = {
  kind: 'debt_prepayment',

  parseParams(raw, state) {
    const reader = ParamsReader.open(raw, ['debtId', 'amount', 'month', 'modality']);
    const debtId = reader.string('debtId') as EntryId | undefined;
    const debt = debtId === undefined ? undefined : findDebt(state, debtId);
    if (debtId !== undefined && debt === undefined) {
      reader.fail('debtId', 'Selecciona una deuda registrada.');
    }
    const amount = reader.amount('amount', 'positive');
    const month = reader.month('month');
    const modality = reader.oneOf('modality', MODALITIES, 'reduce_term');

    if (debt !== undefined && month !== undefined) {
      const pending = pendingAfter(debt, { month });
      const balance = pending.reduce((sum, installment) => sum + installment.amount, 0);
      if (pending.length === 0) {
        reader.fail('month', 'La deuda no tiene cuotas pendientes después de ese mes.');
      } else if (amount !== undefined && amount > balance) {
        reader.fail('amount', `El prepago no puede superar lo pendiente después de ese mes (${formatClpEs(clp(balance))}).`);
      }
    }

    if (debtId === undefined || amount === undefined || month === undefined || modality === undefined || reader.issues.length > 0) {
      return reader.failure();
    }
    return { ok: true, value: { debtId, amount, month, modality } };
  },

  apply(state, params) {
    return {
      ...state,
      debts: state.debts.map((debt) => {
        if (debt.id !== params.debtId) {
          return debt;
        }
        const pending = pendingAfter(debt, params);
        const reduced = reducedAmounts(pending, params.amount, params.modality);
        const untouched = debt.installments.filter((installment) => compareYearMonth(installment.month, params.month) <= 0);
        const remaining = pending
          .map((installment, index) => ({ month: installment.month, amount: clp(reduced[index] ?? 0) }))
          .filter((installment) => installment.amount > 0);
        return { ...debt, installments: [...untouched, { month: params.month, amount: params.amount }, ...remaining] };
      }),
    };
  },

  describe(params, state) {
    const debt = findDebt(state, params.debtId);
    const label = debt?.label ?? 'la deuda';
    const pending = debt === undefined ? [] : pendingAfter(debt, params);
    const reduced = reducedAmounts(pending, params.amount, params.modality);
    const intro = `Prepago de ${formatClpEs(params.amount)} a «${label}» en ${formatMonthEs(params.month)}, ${MODALITY_TEXT[params.modality]}.`;

    if (params.modality === 'reduce_term') {
      const lastBefore = pending[pending.length - 1];
      const lastIndexAfter = reduced.findLastIndex((value) => value > 0);
      const lastAfter = pending[lastIndexAfter];
      if (lastBefore === undefined) {
        return intro;
      }
      return lastAfter === undefined
        ? `${intro} La deuda queda pagada con el prepago.`
        : `${intro} La última cuota pasa de ${formatMonthEs(lastBefore.month)} a ${formatMonthEs(lastAfter.month)}.`;
    }

    const first = pending[0];
    return first === undefined
      ? intro
      : `${intro} La cuota pasa de ${formatClpEs(first.amount)} a ${formatClpEs(clp(reduced[0] ?? 0))}.`;
  },
};
