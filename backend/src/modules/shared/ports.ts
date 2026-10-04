/** Wall clock. Modules read time through this port so tests can fix it; the core never does. */
export interface Clock {
  now(): Date;
}

/** Generates opaque random identifiers (UUID v4) for new records. */
export interface IdGenerator {
  newId(): string;
}
