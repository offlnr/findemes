import type { Actor } from '../../shared/actor.ts';

/** HU21 (Ley 21.719): export and effective erasure of the actor's own personal data. */
export interface PersonalDataStore {
  exportForActor(actor: Actor): Promise<Readonly<Record<string, unknown>>>;
  eraseForActor(actor: Actor): Promise<void>;
}
