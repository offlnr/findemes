import { clp, compareYearMonth, type EntryId, type Expense, type Schedule } from '../../../core/index.ts';
import type { HouseholdId, UserId } from '../../shared/actor.ts';

export const MAX_HOUSEHOLD_AMOUNT = 1_000_000_000_000;
/** 10 000 basis points = 100 % (migration 0004, contribution_shares). */
export const FULL_SHARE = 10_000;
/** HU31 "vigencia limitada": the database accepts at most 7 days. */
export const INVITATION_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

export interface HouseholdMember {
  readonly userId: UserId;
  readonly displayName: string;
  readonly role: 'admin' | 'member';
  readonly joinedAt: Date;
}

/** HU14: how a shared expense is split among the members. */
export type ContributionRule =
  | { readonly mode: 'equal' }
  | { readonly mode: 'percentage'; readonly shares: readonly { readonly userId: UserId; readonly basisPoints: number }[] }
  | { readonly mode: 'assigned'; readonly userId: UserId };

/** HU13: visible to every member together with who registered it. */
export interface SharedExpense {
  readonly id: string;
  readonly label: string;
  readonly amount: number;
  readonly schedule: Schedule;
  /** `null` once the author erased their account. */
  readonly createdBy: UserId | null;
  readonly createdByName: string;
  readonly rule: ContributionRule;
}

export interface HouseholdSnapshot {
  readonly id: HouseholdId;
  readonly name: string;
  readonly members: readonly HouseholdMember[];
  readonly expenses: readonly SharedExpense[];
  /** HU20: false when no member has a plan in force that includes the shared space. */
  readonly spaceActive: boolean;
}

export interface HouseholdIssue {
  readonly field: string;
  readonly message: string;
}

/** Members in a stable order (seniority), so remainders always go to the same people. */
function bySeniority(members: readonly HouseholdMember[]): HouseholdMember[] {
  return [...members].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.userId.localeCompare(b.userId));
}

/**
 * Integer split of one shared expense (rule 10). The pesos left over by integer division go one
 * by one to the members in order of seniority, so the parts always add up to the amount.
 * Returns the amount charged to each member (members with nothing are omitted).
 */
export function splitExpense(expense: Pick<SharedExpense, 'amount' | 'rule'>, members: readonly HouseholdMember[]): ReadonlyMap<UserId, number> {
  const ordered = bySeniority(members);
  const result = new Map<UserId, number>();
  if (ordered.length === 0) return result;
  const rule = expense.rule;
  switch (rule.mode) {
    case 'assigned': {
      const assignee = ordered.find((member) => member.userId === rule.userId);
      // A rule naming a former member falls back to an equal split (migration 0004 does the same).
      if (assignee === undefined) return splitExpense({ amount: expense.amount, rule: { mode: 'equal' } }, members);
      result.set(assignee.userId, expense.amount);
      return result;
    }
    case 'equal': {
      const base = Math.floor(expense.amount / ordered.length);
      let remainder = expense.amount - base * ordered.length;
      for (const member of ordered) {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        result.set(member.userId, base + extra);
      }
      return result;
    }
    case 'percentage': {
      const shares = new Map(rule.shares.map((share) => [share.userId, share.basisPoints]));
      const holders = ordered.filter((member) => (shares.get(member.userId) ?? 0) > 0);
      if (holders.length === 0) return splitExpense({ amount: expense.amount, rule: { mode: 'equal' } }, members);
      let assigned = 0;
      for (const member of holders) {
        const part = Math.floor((expense.amount * (shares.get(member.userId) ?? 0)) / FULL_SHARE);
        result.set(member.userId, part);
        assigned += part;
      }
      let remainder = expense.amount - assigned;
      for (const member of holders) {
        if (remainder === 0) break;
        result.set(member.userId, (result.get(member.userId) ?? 0) + 1);
        remainder -= 1;
      }
      return result;
    }
  }
}

/**
 * HU15: the member's contribution to each shared expense, as fixed expenses of their individual
 * projection. Information flows from the shared space to the individual profile only (rule 5).
 */
export function contributionsOf(household: Pick<HouseholdSnapshot, 'members' | 'expenses'>, userId: UserId): Expense[] {
  const contributions: Expense[] = [];
  for (const expense of household.expenses) {
    const amount = splitExpense(expense, household.members).get(userId) ?? 0;
    if (amount <= 0) continue;
    contributions.push({
      id: `household:${expense.id}` as EntryId,
      label: `Aporte al hogar: ${expense.label}`,
      nature: 'fixed',
      amount: clp(amount),
      schedule: expense.schedule,
    });
  }
  return contributions;
}

export const labelIssue = (label: string, field = 'label'): HouseholdIssue | null =>
  label.trim().length < 1 || label.trim().length > 80 ? { field, message: 'Ingresa un nombre de hasta 80 caracteres.' } : null;

/** HU13, HU14: a coherent shared expense and a rule that only names current members. */
export function sharedExpenseIssues(
  input: { readonly label: string; readonly amount: number; readonly schedule: Schedule; readonly rule: ContributionRule },
  members: readonly HouseholdMember[],
): HouseholdIssue[] {
  const issues: (HouseholdIssue | null)[] = [labelIssue(input.label)];
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > MAX_HOUSEHOLD_AMOUNT) {
    issues.push({ field: 'amount', message: 'El monto debe ser un número entero de pesos mayor que cero.' });
  }
  const schedule = input.schedule;
  if (schedule.kind === 'every_n_months' && (schedule.intervalMonths < 2 || schedule.intervalMonths > 24)) {
    issues.push({ field: 'schedule.intervalMonths', message: 'La periodicidad debe ser cada 2 a 24 meses.' });
  }
  if (schedule.kind !== 'once' && schedule.until !== null && compareYearMonth(schedule.until, schedule.from) < 0) {
    issues.push({ field: 'schedule.until', message: 'El mes de término no puede ser anterior al mes de inicio.' });
  }
  const memberIds = new Set(members.map((member) => member.userId));
  const rule = input.rule;
  if (rule.mode === 'assigned' && !memberIds.has(rule.userId)) {
    issues.push({ field: 'rule.userId', message: 'El gasto solo puede asignarse a un integrante del hogar.' });
  }
  if (rule.mode === 'percentage') {
    const ids = rule.shares.map((share) => share.userId);
    if (ids.some((id) => !memberIds.has(id)) || new Set(ids).size !== ids.length) {
      issues.push({ field: 'rule.shares', message: 'Cada porcentaje debe corresponder a un integrante distinto del hogar.' });
    } else if (rule.shares.some((share) => !Number.isInteger(share.basisPoints) || share.basisPoints < 1 || share.basisPoints > FULL_SHARE)) {
      issues.push({ field: 'rule.shares', message: 'Cada porcentaje debe ser mayor que 0 % y como máximo 100 %.' });
    } else if (rule.shares.reduce((sum, share) => sum + share.basisPoints, 0) !== FULL_SHARE) {
      issues.push({ field: 'rule.shares', message: 'Los porcentajes deben sumar 100 %.' });
    }
  }
  return issues.filter((issue) => issue !== null);
}
