// In-memory doubles of the identity ports for unit and route tests. They mirror the semantics of
// the SQL functions in migrations 0002 and 0012 (lookup_login, rotate_refresh_token,
// consume_email_token, consume_login_code); the PostgreSQL adapters are tested against the real
// database in test/db.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { IdentityDependencies } from '../../src/modules/identity/application/identity-service.ts';
import type { AccountStatus, EmailTokenPurpose, LoginAttemptLimiter } from '../../src/modules/identity/ports/identity-ports.ts';
import { accountLockMs } from '../../src/modules/identity/domain/session-policy.ts';
import type { EmailMessage } from '../../src/modules/notifications/ports/notification-ports.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

export interface StoredUser {
  id: UserId;
  email: string;
  displayName: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  status: AccountStatus;
}

export class MutableClock {
  current: Date;
  constructor(iso = '2026-11-15T12:00:00Z') {
    this.current = new Date(iso);
  }
  now = () => new Date(this.current);
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

class InMemoryLimiter implements LoginAttemptLimiter {
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();
  private readonly clock: MutableClock;
  constructor(clock: MutableClock) {
    this.clock = clock;
  }

  retryAfterMs(accountKey: string): Promise<number> {
    const entry = this.failures.get(accountKey);
    return Promise.resolve(entry === undefined ? 0 : Math.max(0, entry.lockedUntil - this.clock.now().getTime()));
  }

  recordFailure(accountKey: string): Promise<void> {
    const count = (this.failures.get(accountKey)?.count ?? 0) + 1;
    this.failures.set(accountKey, { count, lockedUntil: this.clock.now().getTime() + accountLockMs(count) });
    return Promise.resolve();
  }

  recordSuccess(accountKey: string): Promise<void> {
    this.failures.delete(accountKey);
    return Promise.resolve();
  }
}

export function createInMemoryIdentity() {
  const clock = new MutableClock();
  const users = new Map<UserId, StoredUser>();
  const refresh = new Map<string, { userId: UserId; family: number; expiresAt: Date; consumed: boolean; revoked: boolean }>();
  const emailTokens = new Map<string, { userId: UserId; purpose: EmailTokenPurpose; expiresAt: Date; used: boolean }>();
  const challenges = new Map<string, { userId: UserId; deviceHash: string; codeHash: string; expiresAt: Date; attempts: number; used: boolean }>();
  const devices = new Map<string, Date>();
  const outbox: EmailMessage[] = [];
  let sequence = 0;
  let families = 0;
  const now = () => clock.now();

  const deps: IdentityDependencies = {
    clock,
    appBaseUrl: 'https://app.test',
    dummyPasswordHash: 'hash:__dummy__',
    // Fast stand-in for argon2id; the real hasher has its own test.
    hasher: {
      hash: (password) => Promise.resolve(`hash:${password}`),
      verify: (hash, password) => Promise.resolve(hash === `hash:${password}`),
    },
    breached: { contains: (password) => password === 'contraseña123' },
    accessTokens: {
      issue: (userId) => Promise.resolve({ token: `access:${userId}`, expiresAt: new Date(now().getTime() + 15 * 60_000) }),
      verify: (token) => Promise.resolve(token.startsWith('access:') ? (token.slice(7) as UserId) : null),
    },
    secrets: {
      opaqueToken: () => randomBytes(32).toString('base64url'),
      sixDigitCode: () => String(100_000 + ++sequence).slice(-6),
      sha256: (secret) => new Uint8Array(createHash('sha256').update(secret).digest()),
      hmac: (value) => new Uint8Array(createHmac('sha256', 'test-key').update(value).digest()),
    },
    email: {
      send: (message) => {
        outbox.push(message);
        return Promise.resolve();
      },
    },
    accounts: {
      lookupLogin: (email) => {
        const user = [...users.values()].find((u) => u.email === email);
        return Promise.resolve(
          user === undefined ? null : { userId: user.id, passwordHash: user.passwordHash, emailVerifiedAt: user.emailVerifiedAt, status: user.status },
        );
      },
      create: (draft) => {
        if ([...users.values()].some((u) => u.email === draft.email)) {
          return Promise.resolve('email_taken' as const);
        }
        const id = randomUUID() as UserId;
        users.set(id, { id, ...draft, emailVerifiedAt: null, status: 'active' });
        return Promise.resolve(id);
      },
      findSelf: (actor) => {
        const user = users.get(actor.userId);
        return Promise.resolve(user === undefined ? null : { ...user });
      },
      passwordHash: (actor) => Promise.resolve(users.get(actor.userId)?.passwordHash ?? null),
      updatePassword: (actor, passwordHash) => {
        const user = users.get(actor.userId);
        if (user !== undefined) user.passwordHash = passwordHash;
        return Promise.resolve();
      },
    },
    refreshTokens: {
      create: (actor, hash, expiresAt) => {
        refresh.set(hex(hash), { userId: actor.userId, family: ++families, expiresAt, consumed: false, revoked: false });
        return Promise.resolve();
      },
      rotate: (oldHash, newHash, expiresAt) => {
        const token = refresh.get(hex(oldHash));
        if (token === undefined || token.revoked || token.expiresAt <= now() || users.get(token.userId)?.status !== 'active') {
          return Promise.resolve({ status: 'invalid' as const });
        }
        if (token.consumed) {
          for (const t of refresh.values()) if (t.family === token.family) t.revoked = true;
          return Promise.resolve({ status: 'reused' as const });
        }
        token.consumed = true;
        refresh.set(hex(newHash), { userId: token.userId, family: token.family, expiresAt, consumed: false, revoked: false });
        return Promise.resolve({ status: 'rotated' as const, userId: token.userId });
      },
      revokeFamily: (actor, hash) => {
        const token = refresh.get(hex(hash));
        if (token?.userId === actor.userId) {
          for (const t of refresh.values()) if (t.family === token.family) t.revoked = true;
        }
        return Promise.resolve();
      },
      revokeAllForUser: (actor) => {
        for (const t of refresh.values()) if (t.userId === actor.userId) t.revoked = true;
        return Promise.resolve();
      },
    },
    emailTokens: {
      create: (actor, purpose, hash, expiresAt) => {
        emailTokens.set(hex(hash), { userId: actor.userId, purpose, expiresAt, used: false });
        return Promise.resolve();
      },
      consume: (hash, purpose) => {
        const token = emailTokens.get(hex(hash));
        if (token === undefined || token.used || token.purpose !== purpose || token.expiresAt <= now()) {
          return Promise.resolve(null);
        }
        token.used = true;
        const user = users.get(token.userId);
        if (purpose === 'verify_email' && user !== undefined) user.emailVerifiedAt = now();
        return Promise.resolve(token.userId);
      },
    },
    challenges: {
      create: (actor, deviceHash, codeHash, expiresAt) => {
        const id = randomUUID();
        challenges.set(id, { userId: actor.userId, deviceHash: hex(deviceHash), codeHash: hex(codeHash), expiresAt, attempts: 0, used: false });
        return Promise.resolve(id);
      },
      consume: (id, codeHash) => {
        const challenge = challenges.get(id);
        if (challenge === undefined || challenge.used || challenge.expiresAt <= now() || challenge.attempts >= 5) {
          return Promise.resolve(null);
        }
        if (challenge.codeHash !== hex(codeHash)) {
          challenge.attempts++;
          return Promise.resolve(null);
        }
        if (users.get(challenge.userId)?.status !== 'active') return Promise.resolve(null);
        challenge.used = true;
        devices.set(`${challenge.userId}:${challenge.deviceHash}`, now());
        return Promise.resolve(challenge.userId);
      },
    },
    devices: {
      lastVerifiedAt: (actor, deviceHash) => Promise.resolve(devices.get(`${actor.userId}:${hex(deviceHash)}`) ?? null),
      removeAll: (actor) => {
        for (const key of devices.keys()) if (key.startsWith(`${actor.userId}:`)) devices.delete(key);
        return Promise.resolve();
      },
    },
    limiter: new InMemoryLimiter(clock),
  };

  /** Token or code inside the last email sent to `to`. */
  const lastEmail = (to: string) => {
    const message = outbox.filter((m) => m.to === to).at(-1);
    if (message === undefined) throw new Error(`No email sent to ${to}`);
    return message;
  };
  const tokenFromLastEmail = (to: string) => /token=([^\s]+)/.exec(lastEmail(to).text)?.[1] ?? '';
  const codeFromLastEmail = (to: string) => /\b(\d{6})\b/.exec(lastEmail(to).text)?.[1] ?? '';

  return { deps, clock, users, outbox, lastEmail, tokenFromLastEmail, codeFromLastEmail };
}
