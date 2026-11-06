// Plans and Webpay payments (HU18-HU20, HU30, Tabla 14) over PostgreSQL with a fake Transbank:
// activation only after the backend commits, idempotent repeated returns, aborted flows, rejected
// payments and amount mismatches (rule 6, OP6).
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccessTokenService } from '../../src/adapters/crypto/jose-access-tokens.ts';
import { createPgPlanReader } from '../../src/adapters/postgres/pg-scenario-store.ts';
import { createPgSubscriptionStore } from '../../src/adapters/postgres/pg-subscription-store.ts';
import { createPgTransactionRunner } from '../../src/adapters/postgres/pg-transaction-runner.ts';
import { buildPublicApi } from '../../src/api/build-public-api.ts';
import { clp } from '../../src/core/index.ts';
import { IdentityService } from '../../src/modules/identity/application/identity-service.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import { SubscriptionService } from '../../src/modules/subscription/application/subscription-service.ts';
import type { PaymentCommitResult, PaymentGateway } from '../../src/modules/subscription/ports/subscription-ports.ts';
import { createInMemoryIdentity } from '../support/in-memory-identity.ts';
import { createTestDatabase, createUser, type TestDatabase } from './harness.ts';

let db: TestDatabase;
let app: FastifyInstance;
const tokens = new Map<string, string>();
let ana: string;
let beto: string;

/** Fake Transbank: remembers each started transaction and answers commit as told. */
const transbank = {
  started: new Map<string, { buyOrder: string; amount: number }>(),
  committed: new Set<string>(),
  nextOutcome: 'authorized' as 'authorized' | 'rejected' | 'wrong_amount',
};
const gateway: PaymentGateway = {
  start(buyOrder, _sessionId, amount) {
    const token = randomBytes(32).toString('hex');
    transbank.started.set(token, { buyOrder, amount });
    return Promise.resolve({ token, redirectUrl: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' });
  },
  commit(token): Promise<PaymentCommitResult> {
    const tx = transbank.started.get(token);
    if (tx === undefined) throw new Error('unknown token');
    if (transbank.committed.has(token)) return Promise.resolve({ status: 'already_committed', buyOrder: '' });
    transbank.committed.add(token);
    if (transbank.nextOutcome === 'rejected') return Promise.resolve({ status: 'rejected', buyOrder: tx.buyOrder, responseCode: '-1' });
    const amount = transbank.nextOutcome === 'wrong_amount' ? tx.amount - 1 : tx.amount;
    return Promise.resolve({ status: 'authorized', buyOrder: tx.buyOrder, amount: clp(amount), responseCode: '0' });
  },
};

beforeAll(async () => {
  db = await createTestDatabase();
  const runner = createPgTransactionRunner(db.api);
  const store = createPgSubscriptionStore(runner);
  const identityEnv = createInMemoryIdentity();
  const accessTokens = createAccessTokenService({
    secret: new Uint8Array(32).fill(5),
    issuer: 'findemes-api',
    audience: 'findemes-app',
    lifetimeMs: 15 * 60_000,
    clock: { now: () => new Date() },
  });
  const service = new SubscriptionService({
    store,
    settlement: store,
    canceller: store,
    gateway,
    plans: createPgPlanReader(runner),
    clock: { now: () => new Date() },
    randomHex: () => randomBytes(16).toString('hex'),
    apiPublicUrl: 'http://localhost:3000',
  });
  app = await buildPublicApi({
    logger: false,
    clock: { now: () => new Date() },
    auth: { identity: new IdentityService({ ...identityEnv.deps, accessTokens }), accessTokens, accounts: identityEnv.deps.accounts, secureCookies: true },
    subscriptions: { service, appBaseUrl: 'http://localhost:8080' },
  });
  await app.ready();
  ana = await createUser(db);
  beto = await createUser(db);
  for (const user of [ana, beto]) tokens.set(user, (await accessTokens.issue(user as UserId)).token);
});

afterAll(async () => {
  await app.close();
  await (db as TestDatabase | undefined)?.drop();
});

const as = (user: string, method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url, headers: { authorization: `Bearer ${tokens.get(user) ?? ''}` }, ...(payload === undefined ? {} : { payload }) });

async function checkout(user: string, plan: 'paid' | 'family') {
  const response = await as(user, 'POST', '/v1/subscription/checkout', { plan });
  expect(response.statusCode).toBe(201);
  return new URL(response.json<{ redirectUrl: string }>().redirectUrl).searchParams.get('token_ws') ?? '';
}
const back = (query: string) => app.inject({ method: 'GET', url: `/v1/payments/webpay/return?${query}` });
const state = async (user: string) => (await as(user, 'GET', '/v1/subscription')).json<{ state: string; plan: { code: string } }>();

describe('plans and payments', () => {
  it('lists the plans publicly with their prices and limits (HU18, HU30)', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/plans' });
    expect(response.statusCode).toBe(200);
    const plans = response.json<{ plans: { code: string; priceClp: number | null; capabilities: { label: string; detail: string }[] }[] }>().plans;
    expect(plans.map((p) => [p.code, p.priceClp])).toEqual([
      ['free', null],
      ['paid', 5990],
      ['family', 9990],
    ]);
    expect(plans[0]?.capabilities.find((c) => c.label === 'Escenarios guardados')?.detail).toBe('Hasta 2 escenarios guardados.');
  });

  it('activates the plan only after the backend commits, once (HU19, rule 6)', async () => {
    expect(await state(ana)).toMatchObject({ state: 'gratuito', plan: { code: 'free' } });
    const token = await checkout(ana, 'paid');
    expect((await state(ana)).state).toBe('pendiente');

    const first = await back(`token_ws=${token}`);
    expect(first.statusCode).toBe(303);
    expect(first.headers.location).toBe('http://localhost:8080/#/app/pago/resultado?estado=aprobado');
    expect(await state(ana)).toMatchObject({ state: 'activa', plan: { code: 'paid' } });

    // The browser returns again (refresh or back button): nothing is activated twice.
    const { rows: before } = await db.owner.query<{ period_end: string }>('SELECT period_end::text FROM app.subscriptions WHERE user_id = $1', [ana]);
    expect((await back(`token_ws=${token}`)).headers.location).toContain('estado=aprobado');
    const { rows: after } = await db.owner.query<{ period_end: string }>('SELECT period_end::text FROM app.subscriptions WHERE user_id = $1', [ana]);
    expect(after).toEqual(before);
  });

  it('marks a payment aborted on Webpay without committing (TBK_TOKEN)', async () => {
    const token = await checkout(beto, 'family');
    const response = await back(`TBK_TOKEN=${token}&TBK_ORDEN_COMPRA=x&TBK_ID_SESION=${beto}`);
    expect(response.headers.location).toContain('estado=anulado');
    expect(transbank.committed.has(token)).toBe(false);
    expect((await state(beto)).plan.code).toBe('free');
  });

  it('reports a rejected payment as failed and keeps the previous plan (Tabla 14 Fallida)', async () => {
    transbank.nextOutcome = 'rejected';
    const token = await checkout(beto, 'paid');
    expect((await back(`token_ws=${token}`)).headers.location).toContain('estado=rechazado');
    expect(await state(beto)).toMatchObject({ state: 'fallida', plan: { code: 'free' } });
  });

  it('flags an amount that does not match the plan and never activates it (HU26)', async () => {
    transbank.nextOutcome = 'wrong_amount';
    const token = await checkout(beto, 'paid');
    expect((await back(`token_ws=${token}`)).headers.location).toContain('estado=en_revision');
    expect((await state(beto)).plan.code).toBe('free');
    const { rows } = await db.owner.query<{ status: string }>('SELECT status FROM app.payment_orders WHERE provider_token = $1', [token]);
    expect(rows[0]?.status).toBe('amount_mismatch');
  });

  it('accepts the form post return and ignores unknown tokens', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payments/webpay/return',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'token_ws=unknown',
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toContain('estado=pendiente');
  });

  it('cancels the renewal while keeping access until the end of the period (Tabla 14 Cancelada)', async () => {
    expect((await as(ana, 'POST', '/v1/subscription/cancel')).json()).toEqual({ cancelled: true });
    expect(await state(ana)).toMatchObject({ state: 'cancelada', plan: { code: 'paid' } });
    expect((await as(beto, 'POST', '/v1/subscription/cancel')).json()).toEqual({ cancelled: false });
  });

  it('never shows one user the orders of another', async () => {
    const response = await as(beto, 'GET', '/v1/subscription');
    const latest = response.json<{ latestPayment: { buyOrder: string } | null }>().latestPayment;
    const { rows } = await db.owner.query<{ buy_order: string }>('SELECT buy_order FROM app.payment_orders WHERE user_id = $1', [ana]);
    expect(rows.map((r) => r.buy_order)).not.toContain(latest?.buyOrder);
    expect((await app.inject({ method: 'GET', url: '/v1/subscription' })).statusCode).toBe(401);
  });
});
