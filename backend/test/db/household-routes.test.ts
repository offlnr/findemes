// Household routes (HU12-HU16, HU31) over the real PostgreSQL adapters: what one member sees of
// another, and cross-access between two households (CLAUDE.md, rule 5).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccessTokenService } from '../../src/adapters/crypto/jose-access-tokens.ts';
import { createPgHouseholdStore } from '../../src/adapters/postgres/pg-household-store.ts';
import { createPgRegistryStore } from '../../src/adapters/postgres/pg-registry-store.ts';
import { createPgPlanReader } from '../../src/adapters/postgres/pg-scenario-store.ts';
import { createPgTransactionRunner } from '../../src/adapters/postgres/pg-transaction-runner.ts';
import { buildPublicApi } from '../../src/api/build-public-api.ts';
import { HouseholdService } from '../../src/modules/household/application/household-service.ts';
import { IdentityService } from '../../src/modules/identity/application/identity-service.ts';
import { RegistryService } from '../../src/modules/registry/application/registry-service.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import { createInMemoryIdentity } from '../support/in-memory-identity.ts';
import { createTestDatabase, createUser, type TestDatabase } from './harness.ts';

let db: TestDatabase;
let app: FastifyInstance;
const tokens = new Map<string, string>();
let ana: string;
let beto: string;
let carla: string;

const monthly = { kind: 'monthly', from: '2026-11', until: null };

beforeAll(async () => {
  db = await createTestDatabase();
  const runner = createPgTransactionRunner(db.api);
  const identityEnv = createInMemoryIdentity();
  const accessTokens = createAccessTokenService({
    secret: new Uint8Array(32).fill(7),
    issuer: 'findemes-api',
    audience: 'findemes-app',
    lifetimeMs: 15 * 60_000,
    clock: { now: () => new Date() },
  });
  const households = new HouseholdService({
    households: createPgHouseholdStore(runner),
    plans: createPgPlanReader(runner),
    secrets: { opaqueToken: () => randomBytes(32).toString('base64url'), sha256: (s) => new Uint8Array(createHash('sha256').update(s).digest()) },
    ids: { newId: () => randomUUID() },
    clock: { now: () => new Date() },
    appBaseUrl: 'http://localhost:8080',
  });
  app = await buildPublicApi({
    logger: false,
    clock: { now: () => new Date() },
    auth: { identity: new IdentityService({ ...identityEnv.deps, accessTokens }), accessTokens, accounts: identityEnv.deps.accounts, secureCookies: true },
    registry: new RegistryService(createPgRegistryStore(runner), { newId: () => randomUUID() }, households),
    households,
  });
  await app.ready();
  ana = await createUser(db);
  beto = await createUser(db);
  carla = await createUser(db);
  for (const user of [ana, beto, carla]) {
    tokens.set(user, (await accessTokens.issue(user as UserId)).token);
    await db.owner.query(
      `INSERT INTO app.subscriptions (user_id, plan_code, period_start, period_end) VALUES ($1, 'family', app.today_cl(), app.today_cl() + 30)`,
      [user],
    );
  }
});

afterAll(async () => {
  await app.close();
  await (db as TestDatabase | undefined)?.drop();
});

const as = (user: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens.get(user) ?? ''}` }, ...(payload === undefined ? {} : { payload }) });

interface HouseholdJson {
  household: {
    id: string;
    myRole: string;
    members: { userId: string; displayName: string; isMe: boolean }[];
    expenses: { id: string; label: string; createdByName: string; myShare: number; canEdit: boolean }[];
    myMonthlyContribution: number;
  } | null;
}

describe('household routes', () => {
  it('create, invite with preview, accept and share expenses (HU12-HU15, HU31)', async () => {
    expect((await as(ana, 'GET', '/v1/household')).json<HouseholdJson>().household).toBeNull();
    expect((await as(ana, 'POST', '/v1/household', { name: 'Depto', displayName: 'Ana' })).statusCode).toBe(201);
    const invitation = await as(ana, 'POST', '/v1/household/invitations');
    expect(invitation.statusCode).toBe(201);
    const token = new URL(invitation.json<{ url: string }>().url.replace('/#/', '/')).searchParams.get('token') ?? '';

    const preview = await app.inject({ method: 'POST', url: '/v1/household/invitations/preview', payload: { token } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ householdName: 'Depto', memberCount: 1 });
    expect(preview.json<{ private: string[] }>().private).toContain('Tus ingresos');

    expect((await as(beto, 'POST', '/v1/household/invitations/accept', { token, displayName: 'Beto' })).statusCode).toBe(200);
    expect((await as(ana, 'POST', '/v1/household/expenses', { label: 'Arriendo', amount: 500_000, schedule: monthly })).statusCode).toBe(201);

    const seen = (await as(beto, 'GET', '/v1/household')).json<HouseholdJson>().household;
    expect(seen?.myRole).toBe('member');
    expect(seen?.members.map((m) => m.displayName)).toEqual(['Ana', 'Beto']);
    expect(seen?.expenses[0]).toMatchObject({ label: 'Arriendo', createdByName: 'Ana', myShare: 250_000, canEdit: false });
    expect(seen?.myMonthlyContribution).toBe(250_000);
    // The member view never carries emails or individual finances.
    expect(JSON.stringify(seen)).not.toMatch(/@example\.cl/);
  });

  it('answers 403 to a member who configures rules and 400 to percentages that do not add up (HU14)', async () => {
    const household = (await as(ana, 'GET', '/v1/household')).json<HouseholdJson>().household;
    const expense = household?.expenses[0]?.id ?? '';
    const rule = { mode: 'percentage', shares: [{ userId: ana, basisPoints: 6000 }, { userId: beto, basisPoints: 3000 }] };
    expect((await as(ana, 'PUT', `/v1/household/expenses/${expense}`, { label: 'Arriendo', amount: 500_000, schedule: monthly, rule })).statusCode).toBe(400);
    expect((await as(beto, 'PUT', `/v1/household/expenses/${expense}`, { label: 'Arriendo', amount: 500_000, schedule: monthly, rule: { mode: 'equal' } })).statusCode).toBe(403);
  });

  it('keeps one household unreachable from another (rule 5)', async () => {
    expect((await as(carla, 'POST', '/v1/household', { name: 'Otra casa', displayName: 'Carla' })).statusCode).toBe(201);
    const anaHousehold = (await as(ana, 'GET', '/v1/household')).json<HouseholdJson>().household;
    const expense = anaHousehold?.expenses[0]?.id ?? '';
    const carlaView = (await as(carla, 'GET', '/v1/household')).json<HouseholdJson>().household;
    expect(carlaView?.expenses).toEqual([]);
    expect((await as(carla, 'PUT', `/v1/household/expenses/${expense}`, { label: 'x', amount: 1, schedule: monthly })).statusCode).toBe(404);
    expect((await as(carla, 'DELETE', `/v1/household/expenses/${expense}`)).statusCode).toBe(404);
    expect((await as(carla, 'DELETE', `/v1/household/members/${beto}`)).statusCode).toBe(404);
    expect((await as(ana, 'GET', '/v1/household')).json<HouseholdJson>().household?.members).toHaveLength(2);
  });

  it('requires a session and rejects unknown fields', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/household' })).statusCode).toBe(401);
    expect((await as(ana, 'POST', '/v1/household/expenses', { label: 'x', amount: 1, schedule: monthly, createdBy: beto })).statusCode).toBe(400);
  });
});
