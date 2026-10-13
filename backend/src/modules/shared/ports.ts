import type { Actor } from './actor.ts';

/** Wall clock. Modules read time through this port so tests can fix it; the core never does. */
export interface Clock {
  now(): Date;
}

/** Generates opaque random identifiers (UUID v4) for new records. */
export interface IdGenerator {
  newId(): string;
}

/** Opaque handle of a database transaction, passed from `withActor` to the repositories. */
export interface Transaction {
  readonly __brand: 'Transaction';
}

/**
 * The only way to touch user data: runs `work` in one transaction as `actor`, which the database
 * uses for Row-Level Security. Everything inside (including the audit entry, HU25) commits or
 * rolls back together. Repositories must refuse to run outside it.
 */
export interface TransactionRunner {
  withActor<T>(actor: Actor | null, work: (tx: Transaction) => Promise<T>): Promise<T>;
}
