// PostgreSQL identity adapters running the full IdentityService flow under the API role, so
// Row-Level Security and the SECURITY DEFINER functions are exercised as in production.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { argon2PasswordHasher } from '../../src/adapters/crypto/argon2-password-hasher.ts';
import { createSecretTools } from '../../src/adapters/crypto/node-secret-tools.ts';
import { createPgIdentityStores } from '../../src/adapters/postgres/pg-identity-stores.ts';
import { clientOf, createPgTransactionRunner } from '../../src/adapters/postgres/pg-transaction-runner.ts';
import { IdentityService } from '../../src/modules/identity/application/identity-service.ts';
import type { EmailMessage } from '../../src/modules/notifications/ports/notification-ports.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import { createTestDatabase, type TestDatabase } from './harness.ts';

let db: TestDatabase;
let service: IdentityService;
let stores: ReturnType<typeof createPgIdentityStores>;
const outbox: EmailMessage[] = [];
const clock = { now: () => new Date() };

beforeAll(async () => {
  db = await createTestDatabase();
  stores = createPgIdentityStores(createPgTransactionRunner(db.api), new Uint8Array(32).fill(3), clock);
  service = new IdentityService({
    ...stores,
    hasher: argon2PasswordHasher,
    breached: { contains: () => false },
    accessTokens: {
      issue: (userId) => Promise.resolve({ token: `access:${userId}`, expiresAt: new Date(Date.now() + 900_000) }),
      verify: () => Promise.resolve(null),
    },
    secrets: createSecretTools(new Uint8Array(32).fill(4)),
    email: { send: (m) => Promise.resolve(void outbox.push(m)) },
    clock,
    appBaseUrl: 'http://localhost:8080',
    dummyPasswordHash: await argon2PasswordHasher.hash('dummy password value'),
  });
});

afterAll(async () => {
  await (db as TestDatabase | undefined)?.drop();
});

const lastTo = (to: string) => outbox.filter((m) => m.to === to).at(-1)?.text ?? '';
const tokenFor = (to: string) => /token=([^\s]+)/.exec(lastTo(to))?.[1] ?? '';
const codeFor = (to: string) => /\b(\d{6})\b/.exec(lastTo(to))?.[1] ?? '';
const PASSWORD = 'correcto caballo batería';

async function userIdOf(email: string): Promise<UserId> {
  const record = await stores.accounts.lookupLogin(email);
  if (record === null) throw new Error(`no account for ${email}`);
  return record.userId;
}

async function signUp(email: string) {
  expect(await service.register({ email, password: PASSWORD, displayName: 'Ana' })).toEqual({ ok: true });
  expect(await service.verifyEmail(tokenFor(email))).toBe(true);
}

describe('PostgreSQL identity stores', () => {
  it('registers under RLS, rejects a duplicate email silently and stores only argon2id hashes', async () => {
    await signUp('ana@example.cl');
    expect(await service.register({ email: 'ana@example.cl', password: PASSWORD, displayName: 'Otra' })).toEqual({ ok: true });

    const { rows } = await db.owner.query<{ password_hash: string; email_verified_at: Date | null }>(
      `SELECT password_hash, email_verified_at FROM app.users WHERE email = 'ana@example.cl'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.email_verified_at).not.toBeNull();
  });

  it('signs in with the emailed code, trusts the device and rotates refresh tokens with reuse detection', async () => {
    await signUp('beto@example.cl');
    const first = await service.login({ email: 'beto@example.cl', password: PASSWORD, deviceId: null, ip: '203.0.113.1' });
    if (first.status !== 'code_required') throw new Error(first.status);

    expect(await service.confirmLoginCode({ challengeId: first.challengeId, code: '000000' })).toBeNull();
    const session = await service.confirmLoginCode({ challengeId: first.challengeId, code: codeFor('beto@example.cl') });
    expect(session).not.toBeNull();

    const again = await service.login({ email: 'beto@example.cl', password: PASSWORD, deviceId: first.deviceId, ip: '203.0.113.1' });
    expect(again.status).toBe('authenticated');

    const next = await service.refresh(session?.refreshToken ?? '');
    expect(next).not.toBeNull();
    expect(await service.refresh(session?.refreshToken ?? '')).toBeNull();
    expect(await service.refresh(next?.refreshToken ?? '')).toBeNull();
  });

  it('locks the account after five failures, storing only keyed hashes', async () => {
    await signUp('carla@example.cl');
    for (let i = 0; i < 5; i++) {
      await service.login({ email: 'carla@example.cl', password: 'no es la clave', deviceId: null, ip: '203.0.113.2' });
    }
    const locked = await service.login({ email: 'carla@example.cl', password: PASSWORD, deviceId: null, ip: '203.0.113.2' });
    expect(locked.status).toBe('locked');

    const { rows } = await db.owner.query<{ key_hash: Buffer }>('SELECT key_hash FROM app.login_throttle');
    expect(rows.every((row) => !row.key_hash.toString('utf8').includes('carla'))).toBe(true);
  });

  it('resets the password with a single-use link and closes every session', async () => {
    await signUp('dani@example.cl');
    const login = await service.login({ email: 'dani@example.cl', password: PASSWORD, deviceId: null, ip: '203.0.113.3' });
    if (login.status !== 'code_required') throw new Error(login.status);
    const session = await service.confirmLoginCode({ challengeId: login.challengeId, code: codeFor('dani@example.cl') });

    await service.requestPasswordReset('dani@example.cl');
    const token = tokenFor('dani@example.cl');
    expect(await service.resetPassword({ token, newPassword: 'una clave nueva larga' })).toEqual({ ok: true });
    expect(await service.resetPassword({ token, newPassword: 'otra clave nueva larga' })).toEqual({ ok: false, reason: 'invalid_token' });
    expect(await service.refresh(session?.refreshToken ?? '')).toBeNull();
  });

  it('never lets one user see another user’s account (RLS)', async () => {
    await signUp('eli@example.cl');
    await signUp('fran@example.cl');
    const eli = await userIdOf('eli@example.cl');
    const fran = await userIdOf('fran@example.cl');

    expect(await stores.accounts.findSelf({ userId: eli })).toMatchObject({ email: 'eli@example.cl' });
    const visible = await createPgTransactionRunner(db.api).withActor({ userId: eli }, async (tx) =>
      (await clientOf(tx).query('SELECT id FROM app.users WHERE id = $1', [fran])).rowCount,
    );
    expect(visible).toBe(0);
  });
});
