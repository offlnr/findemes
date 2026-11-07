import { createDecisionCatalog, type DecisionCatalog } from '../catalog.ts';
import type { DecisionType } from '../decision.ts';
import { debtPrepayment } from './debt-prepayment.ts';
import { fixedExpenseChange } from './fixed-expense-change.ts';
import { incomeVariation } from './income-variation.ts';
import { oneOffExpense } from './one-off-expense.ts';
import { purchaseInInstallments } from './purchase-in-installments.ts';

/** The five decision types of Tabla 11, in the order of MVP_DECISION_KINDS. */
export const MVP_DECISION_TYPES: readonly DecisionType[] = Object.freeze([
  purchaseInInstallments,
  fixedExpenseChange,
  oneOffExpense,
  debtPrepayment,
  incomeVariation,
] as DecisionType[]);

export function createMvpCatalog(): DecisionCatalog {
  return createDecisionCatalog(MVP_DECISION_TYPES);
}
