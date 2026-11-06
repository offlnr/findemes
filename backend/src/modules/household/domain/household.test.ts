import { describe, expect, it } from 'vitest';
import { yearMonth } from '../../../core/index.ts';
import type { UserId } from '../../shared/actor.ts';
import { contributionsOf, sharedExpenseIssues, splitExpense, type HouseholdMember, type SharedExpense } from './household.ts';

const ANA = 'a0000000-0000-4000-8000-000000000001' as UserId;
const BETO = 'a0000000-0000-4000-8000-000000000002' as UserId;
const CATA = 'a0000000-0000-4000-8000-000000000003' as UserId;

const member = (userId: UserId, day: number, role: HouseholdMember['role'] = 'member'): HouseholdMember => ({
  userId,
  displayName: userId.slice(-1),
  role,
  joinedAt: new Date(Date.UTC(2026, 9, day)),
});
// Beto joined first, then Ana, then Cata.
const members = [member(ANA, 2, 'admin'), member(BETO, 1), member(CATA, 3)];
const monthly = { kind: 'monthly', from: yearMonth(2026, 11), until: null } as const;
const rent = (rule: SharedExpense['rule'], amount = 600_000): SharedExpense => ({
  id: 'e1',
  label: 'Arriendo',
  amount,
  schedule: monthly,
  createdBy: ANA,
  createdByName: 'Ana',
  rule,
});

describe('splitExpense (HU14)', () => {
  it('splits equally and gives the leftover pesos to the most senior members', () => {
    const parts = splitExpense(rent({ mode: 'equal' }, 100), members);
    expect([parts.get(BETO), parts.get(ANA), parts.get(CATA)]).toEqual([34, 33, 33]);
  });

  it('splits by percentage with integer pesos that add up to the amount', () => {
    const parts = splitExpense(
      rent({ mode: 'percentage', shares: [{ userId: ANA, basisPoints: 3333 }, { userId: BETO, basisPoints: 6667 }] }, 1000),
      members,
    );
    expect(parts.get(ANA)).toBe(333);
    expect(parts.get(BETO)).toBe(667);
    expect(parts.has(CATA)).toBe(false);
    expect([...parts.values()].reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('charges everything to the assigned member, or splits equally if that member left', () => {
    expect(splitExpense(rent({ mode: 'assigned', userId: CATA }), members).get(CATA)).toBe(600_000);
    const gone = 'a0000000-0000-4000-8000-000000000009' as UserId;
    expect(splitExpense(rent({ mode: 'assigned', userId: gone }), members).get(ANA)).toBe(200_000);
  });
});

describe('contributionsOf (HU15)', () => {
  it('turns the member share into fixed expenses with the same schedule', () => {
    const expenses = contributionsOf({ members, expenses: [rent({ mode: 'equal' })] }, ANA);
    expect(expenses).toEqual([
      { id: 'household:e1', label: 'Aporte al hogar: Arriendo', nature: 'fixed', amount: 200_000, schedule: monthly },
    ]);
    expect(contributionsOf({ members, expenses: [rent({ mode: 'assigned', userId: BETO })] }, ANA)).toEqual([]);
  });
});

describe('sharedExpenseIssues (HU13, HU14)', () => {
  const input = (rule: SharedExpense['rule']) => ({ label: 'Luz', amount: 40_000, schedule: monthly, rule });

  it('accepts a valid expense', () => {
    expect(sharedExpenseIssues(input({ mode: 'equal' }), members)).toEqual([]);
  });

  it('requires percentages that add up to 100 % among distinct members', () => {
    const fields = (rule: SharedExpense['rule']) => sharedExpenseIssues(input(rule), members).map((issue) => issue.message);
    expect(fields({ mode: 'percentage', shares: [{ userId: ANA, basisPoints: 5000 }] })).toEqual(['Los porcentajes deben sumar 100 %.']);
    expect(fields({ mode: 'percentage', shares: [{ userId: ANA, basisPoints: 5000 }, { userId: ANA, basisPoints: 5000 }] })[0]).toMatch(/integrante distinto/);
    expect(fields({ mode: 'assigned', userId: 'x' as UserId })[0]).toMatch(/integrante del hogar/);
  });

  it('rejects empty labels, non-integer amounts and inverted periods', () => {
    const issues = sharedExpenseIssues(
      { label: ' ', amount: 10.5, schedule: { kind: 'monthly', from: yearMonth(2026, 11), until: yearMonth(2026, 10) }, rule: { mode: 'equal' } },
      members,
    );
    expect(issues.map((issue) => issue.field)).toEqual(['label', 'amount', 'schedule.until']);
  });
});
