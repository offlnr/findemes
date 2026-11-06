// Bank aggregation (HU36, ADR-002) over PostgreSQL with the demo bank: consent first, encrypted
// link tokens, idempotent syncs, user-confirmed recurring entries that keep their origin, and
// cross-access between users (rule 5).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAesGcmTokenCipher } from '../../src/adapters/crypto/aes-gcm-token-cipher.ts';
import { createAccessTokenService } from '../../src/adapters/crypto/jose-access-tokens.ts';
import { createDemoBankAggregator, demoLinkToken } from '../../src/adapters/demo-bank/demo-bank.ts';
import { DEMO_PROFILES } from '../../src/adapters/demo-bank/profiles.ts';
import { createPgBankStore } from '../../src/adapters/postgres/pg-bank-store.ts';
import { createPgPrivacyStore } from '../../src/adapters/postgres/pg-privacy-store.ts';
import { createPgRegistryStore } from '../../src/adapters/postgres/pg-registry-store.ts';
import { createPgTransactionRunner } from '../../src/adapters/postgres/pg-transaction-runner.ts';
import { buildPublicApi } from '../../src/api/build-public-api.ts';
import { AggregationService } from '../../src/modules/aggregation/application/aggregation-service.ts';
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
const clock = { now: () => new Date('2026-11-06T15:00:00Z') };

beforeAll(async () => {
  db = await createTestDatabase();
  const runner = createPgTransactionRunner(db.api);
  const privacy = createPgPrivacyStore(runner);
  const identityEnv = createInMemoryIdentity();
  const accessTokens = createAccessTokenService({ secret: new Uint8Array(32).fill(4), issuer: 'findemes-api', audience: 'findemes-app', lifetimeMs: 15 * 60_000, clock });
  const aggregation = new AggregationService({
    store: createPgBankStore(runner),
    demo: { aggregator: createDemoBankAggregator(clock), profiles: DEMO_PROFILES.map(({ id, label }) => ({ id, label })), linkTokenOf: demoLinkToken },
    cipher: createAesGcmTokenCipher(new Map([[1, new Uint8Array(32).fill(8)]]), 1),
    hasBankConsent: async (actor) => (await privacy.listForActor(actor)).some((c) => c.kind === 'bank_connection' && c.withdrawnAt === null),
    clock,
    ids: { newId: () => randomUUID() },
  });
  app = await buildPublicApi({
    logger: false,
    clock,
    auth: { identity: new IdentityService({ ...identityEnv.deps, accessTokens }), accessTokens, accounts: identityEnv.deps.accounts, secureCookies: true },
    registry: new RegistryService(createPgRegistryStore(runner), { newId: () => randomUUID() }),
    aggregation,
  });
  await app.ready();
  ana = await createUser(db);
  beto = await createUser(db);
  for (const user of [ana, beto]) tokens.set(user, (await accessTokens.issue(user as UserId)).token);
  await privacy.accept({ actor: { userId: ana as UserId }, ip: '127.0.0.1' }, 'bank_connection', '2026-11');
});

afterAll(async () => {
  await app.close();
  await (db as TestDatabase | undefined)?.drop();
});

const as = (user: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens.get(user) ?? ''}` }, ...(payload === undefined ? {} : { payload }) });

interface LinksJson {
  links: { id: string; provider: string; origin: string; accounts: { id: string; availableBalance: number; origin: string }[] }[];
}
interface MovementsJson {
  movements: { id: string; amount: number; description: string; origin: string; confirmedAs: string | null }[];
  totals: { month: string; credits: number; debits: number }[];
}

describe('bank routes', () => {
  it('offers the demo bank and requires the bank consent before connecting (Ley 21.719)', async () => {
    const providers = (await as(beto, 'GET', '/v1/bank/providers')).json<{ fintoc: { available: boolean }; demoProfiles: { id: string }[] }>();
    expect(providers.fintoc.available).toBe(false);
    expect(providers.demoProfiles.map((p) => p.id)).toContain('familia');
    const refused = await as(beto, 'POST', '/v1/bank/links', { provider: 'demo', profileId: 'familia' });
    expect(refused.statusCode).toBe(409);
    expect((await as(ana, 'POST', '/v1/bank/fintoc/link-intents')).statusCode).toBe(503);
  });

  it('connects a demo profile, stores the token encrypted and syncs accounts and movements (HU36)', async () => {
    const connected = await as(ana, 'POST', '/v1/bank/links', { provider: 'demo', profileId: 'familia' });
    expect(connected.statusCode).toBe(201);
    const links = (await as(ana, 'GET', '/v1/bank/links')).json<LinksJson>().links;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ provider: 'demo', origin: 'demo' });
    expect(links[0]?.accounts[0]?.origin).toBe('demo');

    const { rows } = await db.owner.query<{ token_ciphertext: Buffer }>('SELECT token_ciphertext FROM app.bank_links WHERE owner_id = $1', [ana]);
    expect(rows[0]?.token_ciphertext.toString('utf8')).not.toContain('demo:familia');

    const movements = (await as(ana, 'GET', '/v1/bank/movements?months=3')).json<MovementsJson>();
    expect(movements.movements.length).toBeGreaterThan(5);
    expect(movements.totals.map((t) => t.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(movements.movements.every((m) => m.origin === 'demo')).toBe(true);
  });

  it('syncs again without duplicating movements', async () => {
    const linkId = (await as(ana, 'GET', '/v1/bank/links')).json<LinksJson>().links[0]?.id ?? '';
    const count = async () => Number((await db.owner.query<{ n: string }>('SELECT count(*) AS n FROM app.bank_movements WHERE owner_id = $1', [ana])).rows[0]?.n);
    const before = await count();
    expect((await as(ana, 'POST', `/v1/bank/links/${linkId}/sync`)).statusCode).toBe(204);
    expect(await count()).toBe(before);
  });

  it('turns a movement the user confirms into a labelled registry entry, and an account into the opening balance', async () => {
    const movements = (await as(ana, 'GET', '/v1/bank/movements?months=2')).json<MovementsJson>().movements;
    const credit = movements.find((m) => m.amount > 0);
    if (credit === undefined) throw new Error('the demo profile has a salary');
    expect((await as(ana, 'POST', `/v1/bank/movements/${credit.id}/confirm`, { label: 'Sueldo' })).statusCode).toBe(201);
    const confirmed = (await as(ana, 'GET', '/v1/bank/movements?months=2')).json<MovementsJson>().movements.find((m) => m.id === credit.id);
    expect(confirmed?.confirmedAs).toBe('income');

    const account = (await as(ana, 'GET', '/v1/bank/links')).json<LinksJson>().links[0]?.accounts[0];
    expect((await as(ana, 'POST', `/v1/bank/accounts/${account?.id ?? ''}/opening-balance`)).statusCode).toBe(204);

    const registry = (await as(ana, 'GET', '/v1/registry')).json<{ openingBalance: { amount: number; origin: string }; incomes: { label: string; amount: number; origin: string }[] }>();
    expect(registry.incomes).toEqual([expect.objectContaining({ label: 'Sueldo', amount: credit.amount, origin: 'demo' })]);
    expect(registry.openingBalance).toMatchObject({ amount: account?.availableBalance, origin: 'demo' });
  });

  it('keeps every bank resource of one user unreachable for another (rule 5)', async () => {
    const link = (await as(ana, 'GET', '/v1/bank/links')).json<LinksJson>().links[0];
    const movement = (await as(ana, 'GET', '/v1/bank/movements')).json<MovementsJson>().movements[0];
    expect((await as(beto, 'GET', '/v1/bank/links')).json<LinksJson>().links).toEqual([]);
    expect((await as(beto, 'GET', '/v1/bank/movements')).json<MovementsJson>().movements).toEqual([]);
    expect((await as(beto, 'POST', `/v1/bank/links/${link?.id ?? ''}/sync`)).statusCode).toBe(404);
    expect((await as(beto, 'DELETE', `/v1/bank/links/${link?.id ?? ''}`)).statusCode).toBe(404);
    expect((await as(beto, 'POST', `/v1/bank/movements/${movement?.id ?? ''}/confirm`, { label: 'x' })).statusCode).toBe(404);
    expect((await as(beto, 'POST', `/v1/bank/accounts/${link?.accounts[0]?.id ?? ''}/opening-balance`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/bank/links' })).statusCode).toBe(401);
  });

  it('disconnects the bank and keeps what the user confirmed in the registry', async () => {
    const linkId = (await as(ana, 'GET', '/v1/bank/links')).json<LinksJson>().links[0]?.id ?? '';
    expect((await as(ana, 'DELETE', `/v1/bank/links/${linkId}`)).statusCode).toBe(204);
    expect((await as(ana, 'GET', '/v1/bank/links')).json<LinksJson>().links).toEqual([]);
    const registry = (await as(ana, 'GET', '/v1/registry')).json<{ incomes: { label: string; origin: string }[] }>();
    expect(registry.incomes.map((i) => [i.label, i.origin])).toEqual([['Sueldo', 'demo']]);
  });
});
