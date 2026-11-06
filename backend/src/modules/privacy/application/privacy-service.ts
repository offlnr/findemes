import type { PasswordHasher } from '../../identity/ports/identity-ports.ts';
import type { Actor } from '../../shared/actor.ts';
import type { WriteContext } from '../../shared/ports.ts';
import type { Consent, ConsentKind, ConsentStore, PersonalDataExport, PersonalDataStore } from '../ports/privacy-ports.ts';

/** Versions of the documents in force (HU32). A new version is accepted as a new consent. */
export const DOCUMENT_VERSIONS: Readonly<Record<ConsentKind, string>> = Object.freeze({
  terms: '2026-11',
  privacy_policy: '2026-11',
  bank_connection: '2026-11',
});

export interface PrivacyDeps {
  readonly data: PersonalDataStore;
  readonly consents: ConsentStore;
  readonly hasher: PasswordHasher;
  /** The actor's own password hash, to confirm an erasure. */
  readonly passwordHashOf: (actor: Actor) => Promise<string | null>;
  /** Runs before the erasure, e.g. to revoke bank access at the provider (HU21, ADR-002). */
  readonly beforeErase?: (actor: Actor) => Promise<void>;
}

/** HU21 and HU32: the user's rights over their personal data and the consents they gave. */
export class PrivacyService {
  private readonly deps: PrivacyDeps;

  constructor(deps: PrivacyDeps) {
    this.deps = deps;
  }

  /** Structured export of everything stored about the actor. */
  export(actor: Actor): Promise<PersonalDataExport> {
    return this.deps.data.exportForActor(actor);
  }

  /** Rectification of the account alias; financial records are rectified in their own screens. */
  async rectify(context: WriteContext, input: { readonly displayName: string }): Promise<{ ok: true } | { ok: false; field: string; message: string }> {
    const name = input.displayName.trim();
    if (name.length < 1 || name.length > 80) return { ok: false, field: 'displayName', message: 'Ingresa un nombre de hasta 80 caracteres.' };
    await this.deps.data.updateDisplayName(context, name);
    return { ok: true };
  }

  /**
   * Effective erasure. Confirmed with the current password, so a stolen access token alone
   * cannot delete the account. The household passes to its most senior member (decision
   * 20-10-2026); erasure is never blocked.
   */
  async erase(context: WriteContext, password: string): Promise<'erased' | 'invalid_password'> {
    const hash = await this.deps.passwordHashOf(context.actor);
    if (hash === null || !(await this.deps.hasher.verify(hash, password))) return 'invalid_password';
    await this.deps.beforeErase?.(context.actor);
    await this.deps.data.eraseForActor(context);
    return 'erased';
  }

  consents(actor: Actor): Promise<readonly Consent[]> {
    return this.deps.consents.listForActor(actor);
  }

  /** Accepts the version in force of a document. */
  async accept(context: WriteContext, kind: ConsentKind): Promise<string> {
    const version = DOCUMENT_VERSIONS[kind];
    await this.deps.consents.accept(context, kind, version);
    return version;
  }

  withdraw(context: WriteContext, kind: ConsentKind): Promise<boolean> {
    return this.deps.consents.withdraw(context, kind);
  }
}
