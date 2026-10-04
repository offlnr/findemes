import type { Actor } from '../../shared/actor.ts';
import type { Scenario, ScenarioDraft, ScenarioId } from '../domain/scenario.ts';

/** Every method filters by the actor; another user's scenario behaves as nonexistent (404). */
export interface ScenarioRepository {
  listForActor(actor: Actor): Promise<readonly Scenario[]>;
  findForActor(actor: Actor, id: ScenarioId): Promise<Scenario | null>;
  /**
   * Creates the scenario only if the actor has fewer than `maxScenarios`, atomically (one
   * transaction or constraint), so concurrent requests cannot exceed the plan limit (Tabla 13).
   */
  createIfUnderLimit(
    actor: Actor,
    draft: ScenarioDraft,
    maxScenarios: number,
  ): Promise<'created' | 'limit_reached'>;
  /** Returns false when the scenario does not exist for this actor. */
  updateForActor(actor: Actor, draft: ScenarioDraft): Promise<boolean>;
  deleteForActor(actor: Actor, id: ScenarioId): Promise<boolean>;
}
