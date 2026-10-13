import type { Actor } from '../../shared/actor.ts';
import type { Scenario, ScenarioDraft, ScenarioId } from '../domain/scenario.ts';

/** Every method filters by the actor; another user's scenario behaves as nonexistent (404). */
export interface ScenarioRepository {
  listForActor(actor: Actor): Promise<readonly Scenario[]>;
  findForActor(actor: Actor, id: ScenarioId): Promise<Scenario | null>;
  /**
   * Creates the scenario only while the actor is under the limit of the plan in force
   * (Tabla 13). The database reads the plan and serializes concurrent requests, so the limit
   * cannot be exceeded.
   */
  createIfUnderLimit(actor: Actor, draft: ScenarioDraft): Promise<'created' | 'limit_reached'>;
  /** Returns false when the scenario does not exist for this actor. */
  updateForActor(actor: Actor, draft: ScenarioDraft): Promise<boolean>;
  deleteForActor(actor: Actor, id: ScenarioId): Promise<boolean>;
}
