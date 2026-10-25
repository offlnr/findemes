import type { MonthRange, YearMonth } from '../calendar/year-month.ts';
import type { EntryId } from '../financial-state/financial-state.ts';
import type { Clp } from '../money/clp.ts';

/**
 * Parameters of the five MVP decision types (Tabla 11). Implementations come later, test-first;
 * this file fixes the contract the API and the app build against.
 */
export const MVP_DECISION_KINDS = [
  'purchase_in_installments',
  'fixed_expense_change',
  'one_off_expense',
  'debt_prepayment',
  'income_variation',
] as const;

export type MvpDecisionKind = (typeof MVP_DECISION_KINDS)[number];

/**
 * "Compra en N cuotas": monto total, número de cuotas, mes de inicio.
 * The split of a total that is not divisible by N is fixed during the engine's TDD.
 */
export interface PurchaseInInstallmentsParams {
  readonly label: string;
  readonly totalAmount: Clp;
  readonly installments: number;
  readonly startMonth: YearMonth;
}

/**
 * "Alta o modificación de gasto fijo": monto, mes de inicio, carácter permanente o acotado.
 * `targetExpenseId: null` adds a new fixed expense; otherwise it replaces the amount of an
 * existing one within `range`.
 */
export interface FixedExpenseChangeParams {
  readonly label: string;
  readonly targetExpenseId: EntryId | null;
  readonly amount: Clp;
  readonly range: MonthRange;
}

/** "Gasto único": monto, mes específico. */
export interface OneOffExpenseParams {
  readonly label: string;
  readonly amount: Clp;
  readonly month: YearMonth;
}

/**
 * How the institution applies a prepayment. The app never pays debts and does not know the
 * issuer's rule, so the user chooses it (decision of 2026-10-02):
 * - `reduce_term`: whole installments are extinguished starting from the last one.
 * - `reduce_installment`: the prepayment is spread over the remaining installments.
 */
export type PrepaymentModality = 'reduce_term' | 'reduce_installment';

/** "Adelanto o prepago de deuda": deuda de origen, monto del prepago, mes de aplicación. */
export interface DebtPrepaymentParams {
  readonly debtId: EntryId;
  readonly amount: Clp;
  readonly month: YearMonth;
  /** Defaults to `reduce_term` when the caller omits it. */
  readonly modality: PrepaymentModality;
}

/**
 * "Variación de ingreso": monto de la variación, mes de inicio, rango. The only signed amount
 * among the decision params; every other amount must be positive (checked in `parseParams`).
 */
export interface IncomeVariationParams {
  readonly label: string;
  readonly amount: Clp;
  readonly range: MonthRange;
}
