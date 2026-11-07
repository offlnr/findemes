import type { Actor } from '../../shared/actor.ts';
import type { WriteContext } from '../../shared/ports.ts';

export type { WriteContext };

/** Every section of the actor's own personal data, as stored (HU21, structured export). */
export type PersonalDataExport = Readonly<Record<string, unknown>>;

/** HU21 (Ley 21.719): export, rectification and effective erasure of the actor's own data. */
export interface PersonalDataStore {
  exportForActor(actor: Actor): Promise<PersonalDataExport>;
  /** Deletes the account and, by cascade, every individual record. Not reversible. */
  eraseForActor(context: WriteContext): Promise<void>;
  updateDisplayName(context: WriteContext, displayName: string): Promise<void>;
}

export type ConsentKind = 'terms' | 'privacy_policy' | 'bank_connection';

export interface Consent {
  readonly kind: ConsentKind;
  readonly documentVersion: string;
  readonly acceptedAt: Date;
  readonly withdrawnAt: Date | null;
}

/** Consent registry (migration 0010): one active consent per kind; withdrawing keeps history. */
export interface ConsentStore {
  listForActor(actor: Actor): Promise<readonly Consent[]>;
  /** Withdraws the active consent of that kind, if any, and records the new acceptance. */
  accept(context: WriteContext, kind: ConsentKind, documentVersion: string): Promise<void>;
  withdraw(context: WriteContext, kind: ConsentKind): Promise<boolean>;
}
