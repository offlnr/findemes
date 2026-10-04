import type { Clp, YearMonth } from '../../../core/index.ts';

/** Bank account read through the aggregator (Fintoc: checking or sight accounts in Chile). */
export interface AggregatedAccount {
  readonly externalId: string;
  readonly name: string;
  readonly type: string;
  /** Available balance, usable as the opening balance of the projection (HU04). */
  readonly availableBalance: Clp;
}

export interface AggregatedMovement {
  readonly externalId: string;
  readonly accountExternalId: string;
  readonly month: YearMonth;
  /** Integer CLP; negative for a debit (cargo), positive for a credit (abono). */
  readonly amount: Clp;
  /** Bank-provided text. Untrusted: escape it wherever it is shown. */
  readonly description: string;
  /** True while the integration runs in the provider's test mode. */
  readonly test: boolean;
}

/**
 * Bank aggregation (HU36), implemented with Fintoc (ADR-002). Optional: the core and the registry
 * work without it (rule 7). `linkToken` grants read access to the user's accounts: it is stored
 * encrypted and never logged.
 */
export interface BankAggregator {
  listAccounts(linkToken: string): Promise<readonly AggregatedAccount[]>;
  /** Movements posted on or after `since`, or updated after `updatedSince` for incremental syncs. */
  listMovements(
    linkToken: string,
    accountExternalId: string,
    window: { readonly since: YearMonth } | { readonly updatedSince: Date },
  ): Promise<readonly AggregatedMovement[]>;
}
