import { describe, expect, it } from 'vitest';
import type { FinancialState } from '../financial-state/financial-state.ts';
import { createDecisionCatalog } from './catalog.ts';
import type { DecisionType } from './decision.ts';

function fakeType(kind: string): DecisionType {
  return {
    kind,
    parseParams: (raw) => ({ ok: true, value: raw }),
    apply: (state: FinancialState) => state,
    describe: () => `Se aplicó ${kind}.`,
  };
}

describe('createDecisionCatalog', () => {
  it('finds each registered type by its kind', () => {
    const purchase = fakeType('purchase_in_installments');
    const oneOff = fakeType('one_off_expense');
    const catalog = createDecisionCatalog([purchase, oneOff]);

    expect(catalog.get('purchase_in_installments')).toBe(purchase);
    expect(catalog.get('one_off_expense')).toBe(oneOff);
  });

  it('returns undefined for an unknown kind', () => {
    const catalog = createDecisionCatalog([fakeType('one_off_expense')]);
    expect(catalog.get('lottery_win')).toBeUndefined();
  });

  it('does not resolve inherited object properties as kinds', () => {
    const catalog = createDecisionCatalog([fakeType('one_off_expense')]);
    expect(catalog.get('constructor')).toBeUndefined();
    expect(catalog.get('__proto__')).toBeUndefined();
  });

  it('lists kinds in registration order', () => {
    const catalog = createDecisionCatalog([fakeType('b_kind'), fakeType('a_kind')]);
    expect(catalog.kinds()).toEqual(['b_kind', 'a_kind']);
  });

  it('rejects two types with the same kind', () => {
    expect(() =>
      createDecisionCatalog([fakeType('one_off_expense'), fakeType('one_off_expense')]),
    ).toThrow(/one_off_expense/);
  });

  it('rejects kinds that are not snake_case identifiers', () => {
    expect(() => createDecisionCatalog([fakeType('OneOff')])).toThrow(/snake_case/);
    expect(() => createDecisionCatalog([fakeType('')])).toThrow(/snake_case/);
    expect(() => createDecisionCatalog([fakeType('one-off')])).toThrow(/snake_case/);
  });

  it('accepts a new type without changing existing ones (RNF17)', () => {
    const base = [fakeType('one_off_expense')];
    const extended = createDecisionCatalog([...base, fakeType('salary_advance')]);
    expect(extended.get('salary_advance')?.kind).toBe('salary_advance');
    expect(extended.get('one_off_expense')).toBe(base[0]);
  });

  it('cannot be altered after creation', () => {
    const types = [fakeType('one_off_expense')];
    const catalog = createDecisionCatalog(types);
    types.push(fakeType('late_addition'));
    expect(catalog.get('late_addition')).toBeUndefined();
    expect(Object.isFrozen(catalog)).toBe(true);
  });
});
