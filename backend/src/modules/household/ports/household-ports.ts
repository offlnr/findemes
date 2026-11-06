import type { Schedule } from '../../../core/index.ts';
import type { Actor, HouseholdId, UserId } from '../../shared/actor.ts';
import type { WriteContext } from '../../shared/ports.ts';
import type { ContributionRule, HouseholdSnapshot } from '../domain/household.ts';

export type { WriteContext };

export interface HouseholdMembership {
  readonly householdId: HouseholdId;
  readonly memberId: UserId;
  readonly role: 'admin' | 'member';
  /** Name shown to the other members; their email is never exposed. */
  readonly displayName: string;
}

export interface SharedExpenseDraft {
  readonly id: string;
  readonly label: string;
  readonly amount: number;
  readonly schedule: Schedule;
  readonly rule: ContributionRule;
}

export interface InvitationPreview {
  readonly householdName: string;
  readonly memberCount: number;
  readonly expiresAt: Date;
}

/**
 * Household space (HU12-HU16, HU31). Information flows from the shared space to individual
 * profiles, never the other way (rule 5): this port exposes memberships and shared data only,
 * never a member's individual finances. Every method runs as the actor, so the database
 * (Row-Level Security) also refuses what the actor may not see or change. Writes append an audit
 * entry in the same transaction (HU25).
 */
export interface HouseholdRepository {
  /** The household of the actor with members and shared expenses, or `null` if they have none. */
  findForActor(actor: Actor): Promise<HouseholdSnapshot | null>;
  /** The actor becomes its admin. A user belongs to at most one household (MVP). */
  create(context: WriteContext, name: string, displayName: string): Promise<HouseholdId | 'already_member'>;
  /** Only an admin of that household; `false` otherwise. */
  createInvitation(context: WriteContext, householdId: HouseholdId, tokenHash: Uint8Array, expiresAt: Date): Promise<boolean>;
  previewInvitation(tokenHash: Uint8Array): Promise<InvitationPreview | null>;
  acceptInvitation(context: WriteContext, tokenHash: Uint8Array, displayName: string): Promise<HouseholdId | 'invalid' | 'already_member'>;
  /** The admin removes a member, or any member removes themself (leaving). */
  removeMember(context: WriteContext, householdId: HouseholdId, userId: UserId): Promise<boolean>;
  addExpense(context: WriteContext, householdId: HouseholdId, expense: SharedExpenseDraft): Promise<void>;
  /** The author or an admin; `false` when the expense is not reachable for the actor. */
  updateExpense(context: WriteContext, householdId: HouseholdId, expense: SharedExpenseDraft): Promise<boolean>;
  deleteExpense(context: WriteContext, householdId: HouseholdId, expenseId: string): Promise<boolean>;
}
