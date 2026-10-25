import type { Clp, YearMonth } from '../../../core/index.ts';

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
