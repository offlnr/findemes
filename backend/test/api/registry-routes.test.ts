// Registry and projection routes (HU01-HU05, HU39), including cross-access between two users
// (CLAUDE.md, rule 5: every route that exposes individual data has a cross-access test).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccessTokenService } from '../../src/adapters/crypto/jose-access-tokens.ts';
import { buildPublicApi } from '../../src/api/build-public-api.ts';
import { IdentityService } from '../../src/modules/identity/application/identity-service.ts';
import { RegistryService } from '../../src/modules/registry/application/registry-service.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import { createInMemoryIdentity } from '../support/in-memory-identity.ts';
import { createInMemoryRegistry } from '../support/in-memory-registry.ts';

const ANA = '3f2b8c1e-7d4a-4f6b-9c2d-000000000001' as UserId;
const BETO = '3f2b8c1e-7d4a-4f6b-9c2d-000000000002' as UserId;

let app: FastifyInstance;
let registry: ReturnType<typeof createInMemoryRegistry>;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  const identityEnv = createInMemoryIdentity();
  const accessTokens = createAccessTokenService({
    secret: new Uint8Array(32).fill(9),
    issuer: 'findemes-api',
    audience: 'findemes-app',
    lifetimeMs: 15 * 60_000,
    clock: identityEnv.clock,
  });
  registry = createInMemoryRegistry();
  app = await buildPublicApi({
    logger: false,
    clock: identityEnv.clock,
    auth: { identity: new IdentityService({ ...identityEnv.deps, accessTokens }), accessTokens, accounts: identityEnv.deps.accounts, secureCookies: true },
    registry: new RegistryService(registry.repository, registry.ids),
  });
  await app.ready();
  tokens[ANA] = (await accessTokens.issue(ANA)).token;
  tokens[BETO] = (await accessTokens.issue(BETO)).token;
});

afterAll(async () => {
  await app.close();
});

const as = (user: UserId, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens[user] ?? ''}` }, ...(payload === undefined ? {} : { payload }) });

const salary = { label: 'Sueldo', amount: 900_000, schedule: { kind: 'monthly', from: '2026-11', until: null } };

describe('registry routes', () => {
  it('require a session', async () => {
    for (const url of ['/v1/registry', '/v1/projection']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/v1/registry/incomes', payload: salary })).statusCode).toBe(401);
  });

  it('asks for the opening balance before projecting, then projects the registry (HU04, HU05, HU39)', async () => {
    expect((await as(ANA, 'GET', '/v1/projection')).json()).toEqual({
      error: 'opening_balance_required',
      message: 'Registra tu saldo inicial para ver la proyección.',
    });

    expect((await as(ANA, 'PUT', '/v1/registry/opening-balance', { amount: -50_000, month: '2026-11' })).statusCode).toBe(204);
    expect((await as(ANA, 'POST', '/v1/registry/incomes', salary)).statusCode).toBe(201);
    expect(
      (await as(ANA, 'POST', '/v1/registry/expenses', { label: 'Arriendo', amount: 600_000, nature: 'fixed', schedule: { kind: 'monthly', from: '2026-11', until: null } }))
        .statusCode,
    ).toBe(201);
    expect(
      (await as(ANA, 'POST', '/v1/registry/debts', { label: 'Tarjeta', installmentAmount: 150_000, pendingInstallments: 2, nextInstallmentMonth: '2026-11', totalInstallments: 6 }))
        .statusCode,
    ).toBe(201);

    const projection = await as(ANA, 'GET', '/v1/projection?months=3');
    expect(projection.statusCode).toBe(200);
    expect(projection.headers['cache-control']).toBe('no-store');
    const body = projection.json<{ startMonth: string; base: { months: { closingBalance: number }[]; indicators: { breakMonth: string | null } } }>();
    expect(body.startMonth).toBe('2026-11');
    expect(body.base.months.map((m) => m.closingBalance)).toEqual([100_000, 250_000, 550_000]);
    expect(body.base.indicators.breakMonth).toBeNull();

    const snapshot = (await as(ANA, 'GET', '/v1/registry')).json<{ debts: { pendingInstallments: number; nextInstallment: { month: string } }[] }>();
    expect(snapshot.debts[0]).toMatchObject({ pendingInstallments: 2, nextInstallment: { month: '2026-11' } });
  });

  it('rejects unknown fields, wrong schedules and an out-of-range horizon', async () => {
    expect((await as(ANA, 'POST', '/v1/registry/incomes', { ...salary, currency: 'USD' })).statusCode).toBe(400);
    expect((await as(ANA, 'POST', '/v1/registry/incomes', { ...salary, schedule: { kind: 'weekly', from: '2026-11' } })).statusCode).toBe(400);
    expect((await as(ANA, 'POST', '/v1/registry/incomes', { ...salary, amount: 0 })).statusCode).toBe(400);
    const tooLong = await as(ANA, 'GET', '/v1/projection?months=60');
    expect(tooLong.json<{ error: string }>().error).toBe('invalid_horizon');
  });
});

describe('cross-access between users (rule 5)', () => {
  it('answers 404 to another user’s records and never shows them', async () => {
    const created = (await as(ANA, 'POST', '/v1/registry/incomes', { ...salary, label: 'Privado' })).json<{ id: string }>();

    const betoRegistry = (await as(BETO, 'GET', '/v1/registry')).json<{ incomes: unknown[]; openingBalance: unknown }>();
    expect(betoRegistry).toMatchObject({ incomes: [], openingBalance: null });
    expect((await as(BETO, 'GET', '/v1/projection')).statusCode).toBe(409);

    const update = await as(BETO, 'PUT', `/v1/registry/incomes/${created.id}`, salary);
    const remove = await as(BETO, 'DELETE', `/v1/registry/incomes/${created.id}`);
    const unknown = await as(BETO, 'DELETE', '/v1/registry/incomes/3f2b8c1e-7d4a-4f6b-9c2d-0000000000ff');
    expect(update.statusCode).toBe(404);
    expect(remove.statusCode).toBe(404);
    // Someone else's record and a record that does not exist answer exactly the same.
    expect(remove.body).toBe(unknown.body);

    const anaIncomes = (await as(ANA, 'GET', '/v1/registry')).json<{ incomes: { id: string }[] }>().incomes;
    expect(anaIncomes.some((income) => income.id === created.id)).toBe(true);
  });

  it('rejects ids that are not UUIDs before reaching the data', async () => {
    expect((await as(BETO, 'DELETE', '/v1/registry/debts/1 OR 1=1')).statusCode).toBe(400);
  });
});
