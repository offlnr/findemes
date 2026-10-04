import type { Actor, HouseholdId, UserId } from '../../shared/actor.ts';

export interface HouseholdMembership {
  readonly householdId: HouseholdId;
  readonly memberId: UserId;
  readonly role: 'owner' | 'member';
}

/**
 * Household space (HU12-HU16). Information flows from the shared space to individual profiles,
 * never the other way (rule 5): this port exposes memberships and shared data only, never a
 * member's individual finances.
 */
export interface HouseholdRepository {
  findMembershipForActor(actor: Actor): Promise<HouseholdMembership | null>;
}
