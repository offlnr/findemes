export type UserId = string & { readonly __brand: 'UserId' };
export type HouseholdId = string & { readonly __brand: 'HouseholdId' };

/**
 * Authenticated user performing a request. Every repository method that reads or writes
 * personal data receives it, so access is always filtered by owner (deny by default, rule 5).
 */
export interface Actor {
  readonly userId: UserId;
}
