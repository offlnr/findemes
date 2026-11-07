// Admin API (HU22-HU26, RNF22) over PostgreSQL with the app_admin role: password + TOTP, replay
// and lockout, deny by default, account search without financial data, suspension, read-only
// audit trail with its chain check, and payment reconciliation flags.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAdminApi } from '../../src/admin-api/build-admin-api.ts';
import { createAesGcmTokenCipher } from '../../src/adapters/crypto/aes-gcm-token-cipher.ts';
import { argon2PasswordHasher } from '../../src/adapters/crypto/argon2-password-hasher.ts';
import { createAccessTokenService } from '../../src/adapters/crypto/jose-access-tokens.ts';
import { base32Decode, hotp, newTotpSecret, totpStep, verifyTotp } from '../../src/adapters/crypto/totp.ts';
import { createPgAdminDirectory } from '../../src/adapters/postgres/pg-admin-directory.ts';
import { grantPlatformAdmin } from '../../src/adapters/postgres/grant-platform-admin.ts';
import { createPgTransactionRunner } from '../../src/adapters/postgres/pg-transaction-runner.ts';
import { AdminService } from '../../src/modules/administration/application/admin-service.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import { ownerUrl } from './settings.ts';
import { createTestDatabase, type TestDatabase } from './harness.ts';

let db: TestDatabase;
let app: FastifyInstance;
let now = new Date('2026-11-06T15:00:00Z');
const clock = { now: () => now };
const PASSWORD = 'clave del administrador';
const ADMIN_EMAIL = `admin-${randomBytes(4).toString('hex')}@findemes.cl`;
let secret: string;
let adminId: string;
let userId: string;
const publicTokens = createAccessTokenService({ secret: new Uint8Array(32).fill(1), issuer: 'findemes-api', audience: 'findemes-app', lifetimeMs: 900_000, clock });

const code = (at: Date = now) => hotp(base32Decode(secret), totpStep(at));

beforeAll(async () => {
  db = await createTestDatabase();
  const hash = await argon2PasswordHasher.hash(PASSWORD);
  const insert = async (email: string) =>
    (await db.owner.query<{ id: string }>(`INSERT INTO app.users (email, password_hash, display_name, email_verified_at) VALUES ($1, $2, 'Persona', now()) RETURNING id`, [email, hash])).rows[0]?.id ?? '';
  adminId = await insert(ADMIN_EMAIL);
  userId = await insert(`persona-${randomBytes(4).toString('hex')}@example.cl`);
  await db.owner.query(`INSERT INTO app.incomes (owner_id, label, amount, schedule_kind, from_month) VALUES ($1, 'Sueldo secreto', 999999, 'monthly', '2026-11-01')`, [userId]);
  await db.owner.query(`INSERT INTO app.payment_orders (buy_order, user_id, plan_code, amount, status, created_at) VALUES ('FDMOLD', $1, 'paid', 5990, 'created', '2026-11-06T12:00:00Z')`, [userId]);

  const totpKey = new Uint8Array(32).fill(6);
  const cipher = createAesGcmTokenCipher(new Map([[1, totpKey]]), 1);
  secret = newTotpSecret();
  const dbUrl = new URL(ownerUrl());
  dbUrl.pathname = `/${db.name}`;
  expect(await grantPlatformAdmin(dbUrl.toString(), ADMIN_EMAIL, cipher.encrypt(secret))).toBe('granted');

  const admin = new AdminService({
    directory: createPgAdminDirectory(createPgTransactionRunner(db.admin)),
    hasher: argon2PasswordHasher,
    openTotpSecret: (sealed) => cipher.decrypt(sealed),
    verifyTotp,
    tokens: createAccessTokenService({ secret: new Uint8Array(32).fill(2), issuer: 'findemes-admin-api', audience: 'findemes-admin', lifetimeMs: 900_000, clock }),
    clock,
    payments: { status: () => Promise.resolve({ status: 'AUTHORIZED', amount: 5990, buyOrder: 'FDMOLD' }) },
    dummyPasswordHash: await argon2PasswordHasher.hash('dummy password value'),
  });
  app = await buildAdminApi({ logger: false, admin });
  await app.ready();
});

afterAll(async () => {
  await (app as FastifyInstance | undefined)?.close();
  await (db as TestDatabase | undefined)?.drop();
});

const login = (body: object) => app.inject({ method: 'POST', url: '/admin/v1/auth/login', payload: body });
const as = (token: string, method: 'GET' | 'POST', url: string) => app.inject({ method, url, headers: { authorization: `Bearer ${token}` } });
let token = '';

describe('admin API', () => {
  it('requires password and TOTP, refuses a reused code and non-admin accounts (HU22, RNF22)', async () => {
    expect((await login({ email: ADMIN_EMAIL, password: PASSWORD, code: '000000' })).statusCode).toBe(401);
    const ok = await login({ email: ADMIN_EMAIL, password: PASSWORD, code: code() });
    expect(ok.statusCode).toBe(200);
    token = ok.json<{ accessToken: string }>().accessToken;
    // The same code cannot be used twice (replay).
    expect((await login({ email: ADMIN_EMAIL, password: PASSWORD, code: code() })).statusCode).toBe(401);
    now = new Date(now.getTime() + 60_000);
  });

  it('denies a valid session of the public API (HU22)', async () => {
    const publicToken = (await publicTokens.issue(userId as UserId)).token;
    expect((await as(publicToken, 'GET', '/admin/v1/accounts')).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin/v1/accounts' })).statusCode).toBe(401);
  });

  it('finds accounts with plan and status but never their financial data (HU23)', async () => {
    const response = await as(token, 'GET', '/admin/v1/accounts?q=persona-');
    expect(response.statusCode).toBe(200);
    expect(response.json<{ accounts: { id: string; planCode: string }[] }>().accounts).toEqual([expect.objectContaining({ id: userId, planCode: 'free' })]);
    expect(response.body).not.toMatch(/Sueldo secreto|999999/);
    // The admin database role itself cannot read the registry.
    await expect(db.admin.query('SELECT * FROM app.incomes')).rejects.toMatchObject({ code: '42501' });
  });

  it('suspends and reactivates an account, never its own (HU23)', async () => {
    expect((await as(token, 'POST', `/admin/v1/accounts/${userId}/suspend`)).statusCode).toBe(204);
    expect((await db.owner.query<{ status: string }>('SELECT status FROM app.users WHERE id = $1', [userId])).rows[0]?.status).toBe('suspended');
    expect((await as(token, 'POST', `/admin/v1/accounts/${userId}/reactivate`)).statusCode).toBe(204);
    expect((await as(token, 'POST', `/admin/v1/accounts/${adminId}/suspend`)).statusCode).toBe(409);
  });

  it('shows the audit trail with every admin action and an intact chain (HU25)', async () => {
    const response = await as(token, 'GET', '/admin/v1/audit?limit=20');
    const body = response.json<{ brokenAtSeq: number | null; entries: { action: string; actorType: string }[] }>();
    expect(body.brokenAtSeq).toBeNull();
    const actions = body.entries.map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['admin.login', 'admin.account_suspended', 'admin.account_reactivated', 'admin.role_granted']));
    await expect(db.admin.query('DELETE FROM app.audit_log')).rejects.toBeDefined();
  });

  it('flags orders that need a look and reconciles them with Transbank (HU26)', async () => {
    const payments = (await as(token, 'GET', '/admin/v1/payments?status=created')).json<{ payments: { buyOrder: string; flags: string[] }[] }>().payments;
    expect(payments).toEqual([expect.objectContaining({ buyOrder: 'FDMOLD', flags: ['sin_confirmar'] })]);
    await db.owner.query(`UPDATE app.payment_orders SET provider_token = 'tok-old' WHERE buy_order = 'FDMOLD'`);
    const reconciled = await as(token, 'POST', '/admin/v1/payments/FDMOLD/reconcile');
    expect(reconciled.json()).toEqual({ flag: 'cobro_sin_activacion', providerStatus: 'AUTHORIZED' });
  });

  it('reports aggregate metrics only', async () => {
    const metrics = (await as(token, 'GET', '/admin/v1/metrics')).json<{ users: number; activeSubscriptions: object }>();
    expect(metrics.users).toBe(2);
    expect(metrics.activeSubscriptions).toEqual({});
  });

  it('locks the login temporarily after repeated failures (HU17.1)', async () => {
    for (let i = 0; i < 5; i += 1) await login({ email: ADMIN_EMAIL, password: 'incorrecta', code: '123456' });
    const locked = await login({ email: ADMIN_EMAIL, password: PASSWORD, code: code() });
    expect(locked.statusCode).toBe(429);
    now = new Date(now.getTime() + 2 * 60_000);
    expect((await login({ email: ADMIN_EMAIL, password: PASSWORD, code: code() })).statusCode).toBe(200);
  });
});
