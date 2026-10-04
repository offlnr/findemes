import type { FinancialState } from '../../../core/index.ts';
import type { Actor } from '../../shared/actor.ts';

/**
 * Reads the base financial state of the actor (HU01-HU04), ready to be passed to the engine.
 * Returns only the actor's own data; any other owner's records are invisible.
 */
export interface FinancialStateReader {
  loadForActor(actor: Actor): Promise<FinancialState | null>;
}
