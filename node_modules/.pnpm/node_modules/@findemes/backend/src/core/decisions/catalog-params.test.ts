import { describe, expect, it } from 'vitest';
import { MVP_DECISION_KINDS } from './catalog-params.ts';

describe('MVP_DECISION_KINDS', () => {
  it('lists the five decision types of Tabla 11 with stable identifiers', () => {
    expect(MVP_DECISION_KINDS).toEqual([
      'purchase_in_installments',
      'fixed_expense_change',
      'one_off_expense',
      'debt_prepayment',
      'income_variation',
    ]);
  });
});
