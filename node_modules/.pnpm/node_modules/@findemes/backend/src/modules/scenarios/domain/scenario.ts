import type { DecisionInput } from '../../../core/index.ts';
import type { HouseholdId, UserId } from '../../shared/actor.ts';

export type ScenarioId = string & { readonly __brand: 'ScenarioId' };

/** Base state a scenario is derived from: the owner's personal state or a household's. */
export type ScenarioBase =
  | { readonly kind: 'personal' }
  | { readonly kind: 'household'; readonly householdId: HouseholdId };

/**
 * Saved scenario (HU06, HU07, HU11). It stores its name, a reference to its base state and its
 * decisions only: the base is read at simulation time and never copied, so a scenario cannot
 * alter it (rule 3).
 */
export interface Scenario {
  readonly id: ScenarioId;
  readonly ownerId: UserId;
  readonly name: string;
  readonly base: ScenarioBase;
  readonly decisions: readonly DecisionInput[];
}

/** Data to create or update a scenario. The owner always comes from the authenticated actor. */
export type ScenarioDraft = Omit<Scenario, 'ownerId'>;
