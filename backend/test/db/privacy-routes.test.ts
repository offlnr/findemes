// HU21 and HU32 over PostgreSQL: structured export of one's own data only, rectification,
// consents with history, and effective erasure confirmed by password (rule 5, Ley 21.719).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { argon2PasswordHasher } from '../../src/adapters/crypto/argon2-password-hasher.ts';
import { createAccessTokenService } from '../../src/adapters/crypto/jose-access-tokens.ts';
import { createPgPrivacyStore } from '../../src/adapters/postgres/pg-privacy-store.ts';
import { createPgRegistryStore } from '../../src/adapters/postgres/pg-registry-store.ts';
import { createPgTransactionRunner } from '../../src/adapters/postgres/pg-transaction-runner.ts';
import { buildPublicApi } from '../../src/api/build-public-api.ts';
import { yearMonth } from '../../src/core/index.ts';
import { IdentityService } from '../../src/modules/identity/application/identity-service.ts';
import { PrivacyService } from '../../src/modules/privacy/application/privacy-service.ts';
import { RegistryService } from '../../src/modules/registry/application/registry-service.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import { createInMemoryIdentity } from '../support/in-memory-identity.ts';
import { createTestDatabase, type TestDatabase } from './harness.ts';

let db: TestDatabase;
let app: FastifyInstance;
const tokens = new Map<string, string>();
let ana: string;
let beto: string;
const PASSWORD = 'una clave bastante larga';

async function createUserWithPassword(email: string, name: string): Promise<string> {
  const hash = await argon2PasswordHasher.hash(PASSWORD);
  const { rows } = await db.owner.query<{ id: string }>('INSERT INTO app.users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id', [email, hash, name]);
  return rows[0]?.id ?? '';
}

beforeAll(async () => {
  db = await createTestDatabase();
  const runner = createPgTransactionRunner(db.api);
  const store = createPgPrivacyStore(runner);
  const identityEnv = createInMemoryIdentity();
  const accessTokens = createAccessTokenService({
    secret: new Uint8Array(32).fill(3),
    issuer: 'findemes-api',
    audience: 'findemes-app',
    lifetimeMs: 15 * 60_000,
    clock: { now: () => new Date() },
  });
  app = await buildPublicApi({
    logger: false,
    clock: { now: () => new Date() },
    auth: { identity: new IdentityService({ ...identityEnv.deps, accessTokens }), accessTokens, accounts: identityEnv.deps.accounts, secureCookies: true },
    privacy: new PrivacyService({
      data: store,
      consents: store,
      hasher: argon2PasswordHasher,
      passwordHashOf: async (actor) => {
        const { rows } = await db.owner.query<{ password_hash: string }>('SELECT password_hash FROM app.users WHERE id = $1', [actor.userId]);
        return rows[0]?.password_hash ?? null;
      },
    }),
  });
  await app.ready();
  ana = await createUserWithPassword(`ana-${randomUUID()}@example.cl`, 'Ana');
  beto = await createUserWithPassword(`beto-${randomUUID()}@example.cl`, 'Beto');
  for (const user of [ana, beto]) tokens.set(user, (await accessTokens.issue(user as UserId)).token);
  const registry = new RegistryService(createPgRegistryStore(runner), { newId: () => randomUUID() });
  await registry.setOpeningBalance({ actor: { userId: ana as UserId }, ip: '127.0.0.1' }, { amount: 123_456, month: yearMonth(2026, 11) });
  await registry.createIncome({ actor: { userId: ana as UserId }, ip: '127.0.0.1' }, { label: 'Sueldo', amount: 900_000, schedule: { kind: 'monthly', from: yearMonth(2026, 11), until: null } });
});

afterAll(async () => {
  await app.close();
  await (db as TestDatabase | undefined)?.drop();
});

const as = (user: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens.get(user) ?? ''}` }, ...(payload === undefined ? {} : { payload }) });

describe('privacy routes', () => {
  it('exports only my own data, without secrets (HU21)', async () => {
    const response = await as(ana, 'GET', '/v1/me/export');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    const body = response.json<{ cuenta: { alias: string }; ingresos: { label: string }[]; saldo_inicial: { opening_balance: number } }>();
    expect(body.cuenta.alias).toBe('Ana');
    expect(body.ingresos.map((i) => i.label)).toEqual(['Sueldo']);
    expect(body.saldo_inicial.opening_balance).toBe(123_456);
    expect(response.body).not.toMatch(/argon2|password_hash|token_ciphertext/);

    const other = (await as(beto, 'GET', '/v1/me/export')).json<{ ingresos: unknown[]; saldo_inicial: unknown }>();
    expect(other.ingresos).toEqual([]);
    expect(other.saldo_inicial).toBeNull();
  });

  it('rectifies the alias and records consents with their history (HU21, HU32)', async () => {
    expect((await as(ana, 'PATCH', '/v1/me', { displayName: 'Ana María' })).statusCode).toBe(204);
    expect((await as(ana, 'POST', '/v1/consents', { kind: 'terms' })).json()).toEqual({ kind: 'terms', documentVersion: '2026-11' });
    expect((await as(ana, 'POST', '/v1/consents', { kind: 'terms' })).statusCode).toBe(201);
    expect((await as(ana, 'DELETE', '/v1/consents/terms')).statusCode).toBe(204);
    expect((await as(ana, 'DELETE', '/v1/consents/terms')).statusCode).toBe(404);
    const consents = (await as(ana, 'GET', '/v1/consents')).json<{ consents: { withdrawnAt: string | null }[] }>().consents;
    expect(consents).toHaveLength(2);
    expect(consents.every((c) => c.withdrawnAt !== null)).toBe(true);
    expect((await as(beto, 'GET', '/v1/consents')).json<{ consents: unknown[] }>().consents).toEqual([]);
  });

  it('erases the account only with the current password, and the household passes to the next member (HU21)', async () => {
    const { rows } = await db.owner.query<{ id: string }>(`INSERT INTO app.households (name) VALUES ('Casa') RETURNING id`);
    const household = rows[0]?.id;
    await db.owner.query(`INSERT INTO app.household_members (household_id, user_id, role, display_name, joined_at) VALUES ($1, $2, 'admin', 'Ana', now() - interval '1 day'), ($1, $3, 'member', 'Beto', now())`, [
      household,
      ana,
      beto,
    ]);

    expect((await as(ana, 'DELETE', '/v1/me', { password: 'otra clave cualquiera' })).statusCode).toBe(403);
    const erased = await as(ana, 'DELETE', '/v1/me', { password: PASSWORD });
    expect(erased.statusCode).toBe(204);

    const left = await db.owner.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM app.users WHERE id = $1) + (SELECT count(*) FROM app.incomes WHERE owner_id = $1)
            + (SELECT count(*) FROM app.financial_profiles WHERE owner_id = $1) + (SELECT count(*) FROM app.consents WHERE owner_id = $1) AS n`,
      [ana],
    );
    expect(Number(left.rows[0]?.n)).toBe(0);
    const admin = await db.owner.query<{ role: string }>('SELECT role FROM app.household_members WHERE user_id = $1', [beto]);
    expect(admin.rows[0]?.role).toBe('admin');
    const trail = await db.owner.query<{ action: string }>(`SELECT action FROM app.audit_log WHERE actor_id = $1 ORDER BY seq DESC LIMIT 1`, [ana]);
    expect(trail.rows[0]?.action).toBe('privacy.account_erased');
  });
});
