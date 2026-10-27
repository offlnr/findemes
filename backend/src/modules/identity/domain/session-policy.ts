const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Lifetimes fixed in CLAUDE.md (Seguridad) and in migration 0012 (CU-11). */
export const SESSION_POLICY = Object.freeze({
  accessTokenMs: 15 * MINUTE_MS,
  refreshTokenMs: 30 * DAY_MS,
  emailVerificationMs: 24 * HOUR_MS,
  passwordResetMs: 30 * MINUTE_MS,
  loginCodeMs: 10 * MINUTE_MS,
  /** A recognized device asks for the email code again after this time (CU-11). */
  deviceTrustMs: 30 * DAY_MS,
});

/** HU17.1: five consecutive failures lock the account temporarily. */
export const FAILURES_BEFORE_LOCK = 5;
const FIRST_LOCK_MS = MINUTE_MS;
const MAX_LOCK_MS = HOUR_MS;

/**
 * Growing lockout for an account: none before the fifth consecutive failure, then 1 minute,
 * doubling with each further failure up to one hour. Never permanent, so a third party cannot
 * lock someone out for good (CLAUDE.md, Seguridad).
 */
export function accountLockMs(consecutiveFailures: number): number {
  if (consecutiveFailures < FAILURES_BEFORE_LOCK) {
    return 0;
  }
  const doublings = Math.min(consecutiveFailures - FAILURES_BEFORE_LOCK, 6);
  return Math.min(FIRST_LOCK_MS * 2 ** doublings, MAX_LOCK_MS);
}

/** Per-IP limit, independent of the account: protects against spraying many accounts. */
export const IP_POLICY = Object.freeze({ maxFailures: 50, windowMs: 15 * MINUTE_MS });
