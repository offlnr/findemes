import type { UserId } from '../../shared/actor.ts';

export interface UserAccount {
  readonly id: UserId;
  /** Stored normalized (trimmed, lower case). */
  readonly email: string;
  /** argon2id hash; never the password itself (HU17). */
  readonly passwordHash: string;
  readonly emailVerifiedAt: Date | null;
}

/** HU17, HU17.1. */
export interface UserAccountRepository {
  findByEmail(email: string): Promise<UserAccount | null>;
  create(account: UserAccount): Promise<void>;
}

/** argon2id with OWASP parameters (CLAUDE.md, Seguridad). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

/** Short-lived JWT access tokens: fixed algorithm, `iss`, `aud` and `exp` validated. */
export interface AccessTokenService {
  issue(userId: UserId): Promise<string>;
  verify(token: string): Promise<UserId | null>;
}

/**
 * Opaque rotating refresh tokens stored as hashes, with reuse detection (HU17.2, HU17.3).
 * Revoking all sessions of a user invalidates every stored token.
 */
export interface RefreshTokenStore {
  /** Starts a new token family at login. */
  create(userId: UserId, tokenHash: string, expiresAt: Date): Promise<void>;
  /**
   * Atomically consumes `oldHash` and stores `newHash` in the same family (one transaction).
   * - `reused`: `oldHash` was already consumed, so the token leaked; the whole family is revoked.
   * - `invalid`: unknown or expired token.
   */
  rotate(
    oldHash: string,
    newHash: string,
    expiresAt: Date,
  ): Promise<{ readonly status: 'rotated'; readonly userId: UserId } | { readonly status: 'reused' | 'invalid' }>;
  /** Password change or logout everywhere (HU17.2). */
  revokeAllForUser(userId: UserId): Promise<void>;
}

/** HU17.1: temporary lockout with growing delay per account, plus a per-IP limit. */
export interface LoginAttemptLimiter {
  /** Milliseconds the caller must wait before trying again; 0 when allowed. */
  retryAfterMs(accountKey: string, ip: string): Promise<number>;
  recordFailure(accountKey: string, ip: string): Promise<void>;
  recordSuccess(accountKey: string): Promise<void>;
}
