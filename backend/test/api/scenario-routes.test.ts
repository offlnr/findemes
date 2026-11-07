// Scenario routes (HU06-HU11) with plan limits (Tabla 13) and cross-access between two users
// (CLAUDE.md, rule 5).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccessTokenService } from '../../src/adapters/crypto/jose-access-tokens.ts';
import { buildPublicApi } from '../../src/api/build-public-api.ts';
import { IdentityService } from '../../src/modules/identity/application/identity-service.ts';
import { RegistryService } from '../../src/modules/registry/application/registry-service.ts';
import { ScenarioService } from '../../src/modules/scenarios/application/scenario-service.ts';
import { yearMonth } from '../../src/core/index.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import { createInMemoryIdentity } from '../support/in-memory-identity.ts';
import { createInMemoryRegistry } from '../support/in-memory-registry.ts';
import { createInMemoryScenarios } from '../support/in-memory-scenarios.ts';

const ANA = '3f2b8c1e-7d4a-4f6b-9c2d-000000000001' as UserId;
const BETO = '3f2b8c1e-7d4a-4f6b-9c2d-000000000002' as UserId;
const repair = { kind: 'one_off_expense', params: { label: 'Reparación', amount: 500_000, month: '2026-12' } };

let app: FastifyInstance;
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
  const registry = createInMemoryRegistry();
  const scenarios = createInMemoryScenarios();
  const registryService = new RegistryService(registry.repository, registry.ids);
  app = await buildPublicApi({
    logger: false,
    clock: identityEnv.clock,
    auth: { identity: new IdentityService({ ...identityEnv.deps, accessTokens }), accessTokens, accounts: identityEnv.deps.accounts, secureCookies: true },
    registry: registryService,
    scenarios: new ScenarioService({ scenarios: scenarios.repository, registry: registry.repository, plans: scenarios.planReader, ids: registry.ids }),
  });
  await app.ready();
  for (const user of [ANA, BETO]) {
    tokens[user] = (await accessTokens.issue(user)).token;
    await registryService.setOpeningBalance({ actor: { userId: user }, ip: '127.0.0.1' }, { amount: 200_000, month: yearMonth(2026, 11) });
  }
});

afterAll(async () => {
  await app.close();
});

const as = (user: UserId, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens[user] ?? ''}` }, ...(payload === undefined ? {} : { payload }) });

describe('scenario routes', () => {
  it('create, read with variation and explanation, rename and list with the plan (HU06-HU08, HU11)', async () => {
    const created = await as(ANA, 'POST', '/v1/scenarios', { name: 'Arreglar el auto', decisions: [repair] });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();

    const view = await as(ANA, 'GET', `/v1/scenarios/${id}?months=2`);
    expect(view.statusCode).toBe(200);
    const body = view.json<{ startMonth: string; variation: { minimumProjectedBalance: number }; explanation: { summary: string } }>();
    expect(body.startMonth).toBe('2026-11');
    expect(body.variation.minimumProjectedBalance).toBe(-500_000);
    expect(body.explanation.summary).toMatch(/^Con la decisión aplicada/);

    expect((await as(ANA, 'PUT', `/v1/scenarios/${id}`, { name: 'Arreglo', decisions: [repair] })).statusCode).toBe(200);
    const list = (await as(ANA, 'GET', '/v1/scenarios')).json<{ plan: { code: string; maxSavedScenarios: number }; scenarios: { name: string }[] }>();
    expect(list.plan).toMatchObject({ code: 'free', maxSavedScenarios: 2 });
    expect(list.scenarios.map((s) => s.name)).toEqual(['Arreglo']);
  });

  it('answers 422 with the engine issues, 403 at the plan limit and for prepayments on the free plan', async () => {
    const invalid = await as(ANA, 'POST', '/v1/scenarios', { name: 'Mal', decisions: [{ kind: 'one_off_expense', params: { label: 'x', amount: 0, month: '2026-12' } }] });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json<{ issues: { decisionIndex: number }[] }>().issues[0]?.decisionIndex).toBe(0);

    const prepay = await as(ANA, 'POST', '/v1/scenarios', { name: 'Prepago', decisions: [{ kind: 'debt_prepayment', params: { debtId: 'x', amount: 1, month: '2026-11' } }] });
    expect(prepay.statusCode).toBe(403);
    expect(prepay.json<{ error: string }>().error).toBe('plan_limit');

    expect((await as(ANA, 'POST', '/v1/scenarios', { name: 'Dos', decisions: [] })).statusCode).toBe(201);
    const third = await as(ANA, 'POST', '/v1/scenarios', { name: 'Tres', decisions: [] });
    expect(third.statusCode).toBe(403);
  });

  it('compares one scenario against the base on the free plan (HU09)', async () => {
    const ids = (await as(ANA, 'GET', '/v1/scenarios')).json<{ scenarios: { id: string }[] }>().scenarios.map((s) => s.id);
    const one = await as(ANA, 'GET', `/v1/scenarios/compare?ids=${ids[0] ?? ''}&months=2`);
    expect(one.statusCode).toBe(200);
    expect(one.json<{ scenarios: unknown[] }>().scenarios).toHaveLength(1);
    expect((await as(ANA, 'GET', `/v1/scenarios/compare?ids=${ids.join(',')}`)).statusCode).toBe(403);
  });

  it('rejects unknown decision kinds and unknown fields at the schema', async () => {
    expect((await as(ANA, 'POST', '/v1/scenarios', { name: 'x', decisions: [{ kind: 'lottery_win', params: {} }] })).statusCode).toBe(400);
    expect((await as(ANA, 'POST', '/v1/scenarios', { name: 'x', decisions: [], ownerId: BETO })).statusCode).toBe(400);
  });
});

describe('cross-access between users (rule 5)', () => {
  it('answers 404 to another user’s scenario everywhere and never lists it', async () => {
    const ids = (await as(ANA, 'GET', '/v1/scenarios')).json<{ scenarios: { id: string }[] }>().scenarios.map((s) => s.id);
    const target = ids[0] ?? '';
    expect((await as(BETO, 'GET', '/v1/scenarios')).json<{ scenarios: unknown[] }>().scenarios).toEqual([]);
    for (const [method, url, payload] of [
      ['GET', `/v1/scenarios/${target}`, undefined],
      ['PUT', `/v1/scenarios/${target}`, { name: 'x', decisions: [] }],
      ['DELETE', `/v1/scenarios/${target}`, undefined],
      ['GET', `/v1/scenarios/compare?ids=${target}`, undefined],
    ] as const) {
      expect((await as(BETO, method, url, payload)).statusCode).toBe(404);
    }
    expect((await as(ANA, 'GET', `/v1/scenarios/${target}`)).statusCode).toBe(200);
  });
});
