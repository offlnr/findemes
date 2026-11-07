import type { Actor, UserId } from '../../shared/actor.ts';

export type AccountStatus = 'active' | 'suspended';

export interface UserAccount {
  readonly id: UserId;
  /** Stored normalized (trimmed, lower case). */
  readonly email: string;
  /** Alias chosen at registration (CU-08). */
  readonly displayName: string;
  readonly emailVerifiedAt: Date | null;
  readonly status: AccountStatus;
}

/** What credential verification needs, read before the user is known (app.lookup_login). */
export interface LoginRecord {
  readonly userId: UserId;
  /** argon2id hash; never the password itself (HU17). */
  readonly passwordHash: string;
  readonly emailVerifiedAt: Date | null;
  readonly status: AccountStatus;
}

/** HU17, HU17.1, HU17.4. Methods on an existing account require its actor (deny by default). */
export interface UserAccountRepository {
  lookupLogin(email: string): Promise<LoginRecord | null>;
  /** Returns `email_taken` instead of failing when the normalized email already exists. */
  create(draft: { readonly email: string; readonly displayName: string; readonly passwordHash: string }): Promise<UserId | 'email_taken'>;
  findSelf(actor: Actor): Promise<UserAccount | null>;
  passwordHash(actor: Actor): Promise<string | null>;
  updatePassword(actor: Actor, passwordHash: string): Promise<void>;
}

/** argon2id with OWASP parameters (CLAUDE.md, Seguridad). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

/** HU17: local list of breached passwords; never an external call. */
export interface BreachedPasswordList {
  contains(password: string): boolean;
}

/** Short-lived JWT access tokens: fixed algorithm, `iss`, `aud` and `exp` validated. */
export interface AccessTokenService {
  issue(userId: UserId): Promise<{ readonly token: string; readonly expiresAt: Date }>;
  verify(token: string): Promise<UserId | null>;
}

/** Random secrets and their digests. Only digests are stored (CLAUDE.md, Seguridad). */
export interface SecretTools {
  /** 32 random bytes, base64url: refresh tokens, email links, device identifiers. */
  opaqueToken(): string;
  /** Uniformly random 6-digit code for the sign-in challenge (CU-11). */
  sixDigitCode(): string;
  /** SHA-256 of a high-entropy secret (32 bytes). */
  sha256(secret: string): Uint8Array;
  /** HMAC-SHA-256 keyed with a server secret, for low-entropy values such as codes (32 bytes). */
  hmac(value: string): Uint8Array;
}

/**
 * Opaque rotating refresh tokens stored as hashes, with reuse detection (HU17.2, HU17.3).
 * Revoking all sessions of a user invalidates every stored token.
 */
export interface RefreshTokenStore {
  /** Starts a new token family at login. */
  create(actor: Actor, tokenHash: Uint8Array, expiresAt: Date): Promise<void>;
  /**
   * Atomically consumes `oldHash` and stores `newHash` in the same family (app.rotate_refresh_token).
   * - `reused`: `oldHash` was already consumed, so the token leaked; the whole family is revoked.
   * - `invalid`: unknown, expired or revoked token, or the account is not active.
   */
  rotate(
    oldHash: Uint8Array,
    newHash: Uint8Array,
    expiresAt: Date,
  ): Promise<{ readonly status: 'rotated'; readonly userId: UserId } | { readonly status: 'reused' | 'invalid' }>;
  /** Logout of one session: revokes the actor's family of the presented token, if any (HU17.3). */
  revokeFamily(actor: Actor, tokenHash: Uint8Array): Promise<void>;
  /** Password change or logout everywhere (HU17.2, HU17.3). */
  revokeAllForUser(actor: Actor): Promise<void>;
}

export type EmailTokenPurpose = 'verify_email' | 'reset_password';

/** Single-use links sent by email (verification 24 h, reset 30 min), stored as hashes. */
export interface EmailTokenStore {
  create(actor: Actor, purpose: EmailTokenPurpose, tokenHash: Uint8Array, expiresAt: Date): Promise<void>;
  /** Marks the token used and returns its user, or null (app.consume_email_token). */
  consume(tokenHash: Uint8Array, purpose: EmailTokenPurpose): Promise<UserId | null>;
}

/** Email code at sign-in for unrecognized devices (CU-11, migration 0012). */
export interface LoginChallengeStore {
  create(actor: Actor, deviceHash: Uint8Array, codeHash: Uint8Array, expiresAt: Date): Promise<string>;
  /** Spends one attempt on a wrong code; a right one trusts the device (app.consume_login_code). */
  consume(challengeId: string, codeHash: Uint8Array): Promise<UserId | null>;
}

export interface TrustedDeviceStore {
  lastVerifiedAt(actor: Actor, deviceHash: Uint8Array): Promise<Date | null>;
  removeAll(actor: Actor): Promise<void>;
}

/** HU17.1: temporary lockout with growing delay per account, plus a per-IP limit. */
export interface LoginAttemptLimiter {
  /** Milliseconds the caller must wait before trying again; 0 when allowed. */
  retryAfterMs(accountKey: string, ip: string): Promise<number>;
  recordFailure(accountKey: string, ip: string): Promise<void>;
  recordSuccess(accountKey: string): Promise<void>;
}
