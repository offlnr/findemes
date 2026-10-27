import { createHmac, randomUUID } from 'node:crypto';
import { accountLockMs, IP_POLICY } from '../../modules/identity/domain/session-policy.ts';
import type {
  AccountStatus,
  EmailTokenStore,
  LoginAttemptLimiter,
  LoginChallengeStore,
  RefreshTokenStore,
  TrustedDeviceStore,
  UserAccountRepository,
} from '../../modules/identity/ports/identity-ports.ts';
import type { Actor, UserId } from '../../modules/shared/actor.ts';
import type { Clock, TransactionRunner } from '../../modules/shared/ports.ts';
import { clientOf } from './pg-transaction-runner.ts';

const UNIQUE_VIOLATION = '23505';
const bytes = (value: Uint8Array) => Buffer.from(value);

interface Stores {
  readonly accounts: UserAccountRepository;
  readonly refreshTokens: RefreshTokenStore;
  readonly emailTokens: EmailTokenStore;
  readonly challenges: LoginChallengeStore;
  readonly devices: TrustedDeviceStore;
  readonly limiter: LoginAttemptLimiter;
}

/**
 * PostgreSQL implementations of the identity ports (migrations 0002, 0011, 0012). Statements on
 * a user's rows run as that user, so Row-Level Security is the second barrier; work done before
 * the user is known goes through the SECURITY DEFINER functions of the schema.
 */
export function createPgIdentityStores(runner: TransactionRunner, throttleKey: Uint8Array, clock: Clock): Stores {
  const asActor = <T>(actor: Actor | null, sql: string, params: unknown[]) =>
    runner.withActor(actor, async (tx) => (await clientOf(tx).query<T & Record<string, unknown>>(sql, params)).rows);

  const accounts: UserAccountRepository = {
    async lookupLogin(email) {
      const [row] = await asActor<{ user_id: string; password_hash: string; email_verified_at: Date | null; status: AccountStatus }>(
        null,
        'SELECT user_id, password_hash, email_verified_at, status FROM app.lookup_login($1)',
        [email],
      );
      return row === undefined
        ? null
        : { userId: row.user_id as UserId, passwordHash: row.password_hash, emailVerifiedAt: row.email_verified_at, status: row.status };
    },

    async create(draft) {
      // RLS only lets a user insert their own row, so the id is chosen here and set as actor.
      const id = randomUUID() as UserId;
      try {
        const rows = await asActor<{ id: string }>(
          { userId: id },
          `INSERT INTO app.users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)
           ON CONFLICT (email) DO NOTHING RETURNING id`,
          [id, draft.email, draft.displayName, draft.passwordHash],
        );
        return rows.length === 0 ? 'email_taken' : id;
      } catch (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'email_taken';
        throw error;
      }
    },

    async findSelf(actor) {
      const [row] = await asActor<{ id: string; email: string; display_name: string; email_verified_at: Date | null; status: AccountStatus }>(
        actor,
        'SELECT id, email, display_name, email_verified_at, status FROM app.users WHERE id = $1',
        [actor.userId],
      );
      return row === undefined
        ? null
        : { id: row.id as UserId, email: row.email, displayName: row.display_name, emailVerifiedAt: row.email_verified_at, status: row.status };
    },

    async passwordHash(actor) {
      const [row] = await asActor<{ password_hash: string }>(actor, 'SELECT password_hash FROM app.users WHERE id = $1', [actor.userId]);
      return row?.password_hash ?? null;
    },

    async updatePassword(actor, passwordHash) {
      await asActor(actor, 'UPDATE app.users SET password_hash = $2, updated_at = now() WHERE id = $1', [actor.userId, passwordHash]);
    },
  };

  const refreshTokens: RefreshTokenStore = {
    async create(actor, tokenHash, expiresAt) {
      await asActor(actor, 'INSERT INTO app.refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1, gen_random_uuid(), $2, $3)', [
        actor.userId,
        bytes(tokenHash),
        expiresAt,
      ]);
    },
    async rotate(oldHash, newHash, expiresAt) {
      const [row] = await asActor<{ result: 'rotated' | 'reused' | 'invalid'; result_user_id: string | null }>(
        null,
        'SELECT result, result_user_id FROM app.rotate_refresh_token($1, $2, $3)',
        [bytes(oldHash), bytes(newHash), expiresAt],
      );
      if (row?.result === 'rotated' && row.result_user_id !== null) {
        return { status: 'rotated', userId: row.result_user_id as UserId };
      }
      return { status: row?.result === 'reused' ? 'reused' : 'invalid' };
    },
    async revokeFamily(actor, tokenHash) {
      await asActor(
        actor,
        `UPDATE app.refresh_tokens SET revoked_at = now()
          WHERE revoked_at IS NULL AND family_id = (SELECT family_id FROM app.refresh_tokens WHERE token_hash = $1)`,
        [bytes(tokenHash)],
      );
    },
    async revokeAllForUser(actor) {
      await asActor(actor, 'UPDATE app.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [actor.userId]);
    },
  };

  const emailTokens: EmailTokenStore = {
    async create(actor, purpose, tokenHash, expiresAt) {
      await asActor(actor, 'INSERT INTO app.email_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [
        actor.userId,
        purpose,
        bytes(tokenHash),
        expiresAt,
      ]);
    },
    async consume(tokenHash, purpose) {
      const [row] = await asActor<{ user_id: string | null }>(null, 'SELECT app.consume_email_token($1, $2) AS user_id', [bytes(tokenHash), purpose]);
      return (row?.user_id ?? null) as UserId | null;
    },
  };

  const challenges: LoginChallengeStore = {
    async create(actor, deviceHash, codeHash, expiresAt) {
      const [row] = await asActor<{ id: string }>(
        actor,
        'INSERT INTO app.login_codes (user_id, device_hash, code_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING id',
        [actor.userId, bytes(deviceHash), bytes(codeHash), expiresAt],
      );
      if (row === undefined) throw new Error('login code was not stored');
      return row.id;
    },
    async consume(challengeId, codeHash) {
      const [row] = await asActor<{ user_id: string | null }>(null, 'SELECT app.consume_login_code($1, $2) AS user_id', [challengeId, bytes(codeHash)]);
      return (row?.user_id ?? null) as UserId | null;
    },
  };

  const devices: TrustedDeviceStore = {
    async lastVerifiedAt(actor, deviceHash) {
      const [row] = await asActor<{ verified_at: Date }>(actor, 'SELECT verified_at FROM app.trusted_devices WHERE user_id = $1 AND device_hash = $2', [
        actor.userId,
        bytes(deviceHash),
      ]);
      return row?.verified_at ?? null;
    },
    async removeAll(actor) {
      await asActor(actor, 'DELETE FROM app.trusted_devices WHERE user_id = $1', [actor.userId]);
    },
  };

  // HU17.1. Keys are HMACs of the normalized email or of the IP: no personal data in clear.
  const keyOf = (kind: 'account' | 'ip', value: string) => createHmac('sha256', throttleKey).update(`${kind}:${value}`).digest();

  const limiter: LoginAttemptLimiter = {
    async retryAfterMs(accountKey, ip) {
      const rows = await asActor<{ key_hash: Buffer; failures: number; locked_until: Date | null; updated_at: Date }>(
        null,
        'SELECT key_hash, failures, locked_until, updated_at FROM app.login_throttle WHERE key_hash = ANY($1)',
        [[keyOf('account', accountKey), keyOf('ip', ip)]],
      );
      const now = clock.now().getTime();
      const ipKey = keyOf('ip', ip);
      let wait = 0;
      for (const row of rows) {
        const until = row.key_hash.equals(ipKey)
          ? row.failures >= IP_POLICY.maxFailures
            ? row.updated_at.getTime() + IP_POLICY.windowMs
            : 0
          : (row.locked_until?.getTime() ?? 0);
        wait = Math.max(wait, until - now);
      }
      return Math.max(0, wait);
    },

    async recordFailure(accountKey, ip) {
      const now = clock.now();
      await runner.withActor(null, async (tx) => {
        const client = clientOf(tx);
        const { rows } = await client.query<{ failures: number }>(
          `INSERT INTO app.login_throttle (key_hash, failures, updated_at) VALUES ($1, 1, $2)
           ON CONFLICT (key_hash) DO UPDATE SET failures = app.login_throttle.failures + 1, updated_at = $2
           RETURNING failures`,
          [keyOf('account', accountKey), now],
        );
        const failures = rows[0]?.failures ?? 1;
        const lockMs = accountLockMs(failures);
        if (lockMs > 0) {
          await client.query('UPDATE app.login_throttle SET locked_until = $2 WHERE key_hash = $1', [
            keyOf('account', accountKey),
            new Date(now.getTime() + lockMs),
          ]);
        }
        // The IP counter restarts once its window has passed.
        await client.query(
          `INSERT INTO app.login_throttle (key_hash, failures, updated_at) VALUES ($1, 1, $2)
           ON CONFLICT (key_hash) DO UPDATE SET
             failures = CASE WHEN app.login_throttle.updated_at < $2 - make_interval(secs => $3) THEN 1 ELSE app.login_throttle.failures + 1 END,
             updated_at = $2`,
          [keyOf('ip', ip), now, IP_POLICY.windowMs / 1000],
        );
      });
    },

    async recordSuccess(accountKey) {
      await asActor(null, 'DELETE FROM app.login_throttle WHERE key_hash = $1', [keyOf('account', accountKey)]);
    },
  };

  return { accounts, refreshTokens, emailTokens, challenges, devices, limiter };
}
