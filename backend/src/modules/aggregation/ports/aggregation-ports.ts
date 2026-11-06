import type { Clp, Schedule, YearMonth } from '../../../core/index.ts';
import type { Actor } from '../../shared/actor.ts';
import type { WriteContext } from '../../shared/ports.ts';

export type { WriteContext };

/**
 * Where aggregated data comes from. The app must label anything that is not `real` so test or
 * demo data is never presented as the user's actual bank data.
 * - `real`: provider live mode.
 * - `provider_test`: provider test mode (Fintoc sandbox, random data).
 * - `demo`: Fin de Mes demo bank with curated profiles (validation sessions, thesis defense).
 */
export type DataOrigin = 'real' | 'provider_test' | 'demo';

/** Bank account read through the aggregator (Fintoc: checking or sight accounts in Chile). */
export interface AggregatedAccount {
  readonly externalId: string;
  readonly name: string;
  readonly type: string;
  /** Available balance, usable as the opening balance of the projection (HU04). */
  readonly availableBalance: Clp;
  readonly origin: DataOrigin;
}

export interface AggregatedMovement {
  readonly externalId: string;
  readonly accountExternalId: string;
  /** Posting date, ISO `YYYY-MM-DD`. */
  readonly postedOn: string;
  readonly month: YearMonth;
  /** Integer CLP; negative for a debit (cargo), positive for a credit (abono). */
  readonly amount: Clp;
  /** Bank-provided text. Untrusted: escape it wherever it is shown. */
  readonly description: string;
  readonly origin: DataOrigin;
}

export type MovementWindow = { readonly since: YearMonth } | { readonly updatedSince: Date };

/**
 * Bank aggregation (HU36). Implemented by Fintoc (ADR-002) and by the demo bank; the composition
 * root picks one. Optional: the core and the registry work without it (rule 7). `linkToken`
 * grants read access to the user's accounts: it is stored encrypted and never logged.
 */
export interface BankAggregator {
  listAccounts(linkToken: string): Promise<readonly AggregatedAccount[]>;
  /** Movements posted on or after `since`, or updated after `updatedSince` for incremental syncs. */
  listMovements(
    linkToken: string,
    accountExternalId: string,
    window: MovementWindow,
  ): Promise<readonly AggregatedMovement[]>;
}

/** A connection with one institution (a Fintoc Link, or a demo profile). */
export interface ProviderLink {
  readonly providerLinkId: string;
  /** Read access to the user's accounts at that bank: stored encrypted, never logged. */
  readonly linkToken: string;
  readonly institutionName: string;
  readonly origin: DataOrigin;
}

/**
 * Link lifecycle of Fintoc (ADR-002): the backend creates a Link Intent, the widget collects the
 * bank credentials (never seen by the app or the backend) and returns an exchange token.
 */
export interface BankLinkProvider {
  /** Public key and widget token to open the Fintoc widget. */
  createLinkIntent(): Promise<{ readonly widgetToken: string; readonly publicKey: string }>;
  exchange(exchangeToken: string): Promise<ProviderLink>;
  /** Revokes the provider's access (disconnect, account erasure). Fintoc addresses links by token. */
  revoke(linkToken: string): Promise<void>;
}

/** AES-256-GCM encryption of link tokens in the application (CLAUDE.md, Datos). */
export interface SealedToken {
  readonly ciphertext: Uint8Array;
  readonly nonce: Uint8Array;
  readonly keyVersion: number;
}

export interface TokenCipher {
  encrypt(plaintext: string): SealedToken;
  decrypt(sealed: SealedToken): string;
}

export type BankProvider = 'fintoc' | 'demo';

export interface StoredLink {
  readonly id: string;
  readonly provider: BankProvider;
  readonly providerLinkId: string;
  readonly institutionName: string;
  readonly origin: DataOrigin;
  readonly status: 'active' | 'revoked';
  readonly createdAt: Date;
  readonly lastSyncedAt: Date | null;
  readonly sealedToken: SealedToken;
}

export interface StoredAccount {
  readonly id: string;
  readonly linkId: string;
  readonly externalId: string;
  readonly name: string;
  readonly type: string;
  readonly availableBalance: number;
  readonly origin: DataOrigin;
}

export interface StoredMovement {
  readonly id: string;
  readonly accountId: string;
  readonly postedOn: string;
  readonly amount: number;
  readonly description: string;
  readonly origin: DataOrigin;
  /** Registry entry confirmed from this movement, if any. */
  readonly confirmedAs: 'income' | 'expense' | null;
}

/** A movement the user confirmed as recurring, written to their registry (HU36, HU01, HU02). */
export interface ConfirmedEntry {
  readonly id: string;
  readonly kind: 'income' | 'expense';
  readonly label: string;
  readonly amount: number;
  readonly schedule: Schedule;
  readonly nature: 'fixed' | 'variable_estimate';
}

/**
 * The actor's bank data (migration 0007). Owner only, under RLS; writes append an audit entry
 * with identifiers only (HU25).
 */
export interface BankStore {
  listLinks(actor: Actor): Promise<readonly StoredLink[]>;
  findLink(actor: Actor, linkId: string): Promise<StoredLink | null>;
  /** Reconnecting the same bank updates the existing link (unique per provider link id). */
  upsertLink(context: WriteContext, link: { readonly provider: BankProvider; readonly providerLinkId: string; readonly institutionName: string; readonly origin: DataOrigin; readonly sealedToken: SealedToken }): Promise<string>;
  /** Deletes the link with its accounts and movements; confirmed registry entries stay. */
  deleteLink(context: WriteContext, linkId: string): Promise<boolean>;
  /** Stores accounts and movements idempotently and marks the link as synced. */
  saveSync(context: WriteContext, linkId: string, accounts: readonly AggregatedAccount[], movements: readonly AggregatedMovement[]): Promise<void>;
  listAccounts(actor: Actor): Promise<readonly StoredAccount[]>;
  listMovements(actor: Actor, filter: { readonly accountId?: string; readonly since: string }): Promise<readonly StoredMovement[]>;
  findMovement(actor: Actor, movementId: string): Promise<StoredMovement | null>;
  confirmRecurring(context: WriteContext, movementId: string, entry: ConfirmedEntry): Promise<boolean>;
  /** HU04 from an account: the available balance, labelled with the account's origin. */
  openingBalanceFromAccount(context: WriteContext, accountId: string, month: YearMonth): Promise<boolean>;
}
