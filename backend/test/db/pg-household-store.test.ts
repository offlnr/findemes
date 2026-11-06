// PostgreSQL household adapter under the API role (HU12-HU16, HU20, HU31): shared data only,
// contributions in the individual projection, read-only without a family plan, cross-access.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgHouseholdStore } from '../../src/adapters/postgres/pg-household-store.ts';
import { createPgRegistryStore } from '../../src/adapters/postgres/pg-registry-store.ts';
import { createPgPlanReader } from '../../src/adapters/postgres/pg-scenario-store.ts';
import { createPgTransactionRunner } from '../../src/adapters/postgres/pg-transaction-runner.ts';
import { yearMonth } from '../../src/core/index.ts';
import { HouseholdService } from '../../src/modules/household/application/household-service.ts';
import { RegistryService } from '../../src/modules/registry/application/registry-service.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import { createTestDatabase, createUser, type TestDatabase } from './harness.ts';

let db: TestDatabase;
let households: HouseholdService;
let registry: RegistryService;
const ctx = (userId: string) => ({ actor: { userId: userId as UserId }, ip: '203.0.113.20' });
let ana: string;
let beto: string;
let outsider: string;

const monthly = { kind: 'monthly', from: yearMonth(2026, 11), until: null } as const;

async function giveFamilyPlan(userId: string, active = true) {
  await db.owner.query(
    `INSERT INTO app.subscriptions (user_id, plan_code, period_start, period_end)
     VALUES ($1, 'family', app.today_cl() - 40, app.today_cl() + $2::integer)
     ON CONFLICT (user_id) DO UPDATE SET period_end = EXCLUDED.period_end`,
    [userId, active ? 20 : -5],
  );
}

beforeAll(async () => {
  db = await createTestDatabase();
  const runner = createPgTransactionRunner(db.api);
  const secrets = { opaqueToken: () => randomBytes(32).toString('base64url'), sha256: (s: string) => new Uint8Array(createHash('sha256').update(s).digest()) };
  households = new HouseholdService({
    households: createPgHouseholdStore(runner),
    plans: createPgPlanReader(runner),
    secrets,
    ids: { newId: () => randomUUID() },
    clock: { now: () => new Date() },
    appBaseUrl: 'http://localhost:8080',
  });
  registry = new RegistryService(createPgRegistryStore(runner), { newId: () => randomUUID() }, households);
  ana = await createUser(db);
  beto = await createUser(db);
  outsider = await createUser(db);
});

afterAll(async () => {
  await (db as TestDatabase | undefined)?.drop();
});

const tokenOf = (url: string) => new URL(url.replace('/#/', '/')).searchParams.get('token') ?? '';

describe('PostgreSQL household store', () => {
  it('needs the family plan to create a household (Tabla 13)', async () => {
    const refused = await households.create(ctx(ana), { name: 'Casa', displayName: 'Ana' });
    expect(refused).toMatchObject({ ok: false, reason: 'plan_limit' });
    await giveFamilyPlan(ana);
    expect(await households.create(ctx(ana), { name: 'Casa', displayName: 'Ana' })).toMatchObject({ ok: true });
    expect(await households.create(ctx(ana), { name: 'Otra', displayName: 'Ana' })).toMatchObject({ ok: false, reason: 'already_member' });
  });

  it('invites with a single-use link that shows only the household name before accepting (HU12, HU31)', async () => {
    const invitation = await households.invite(ctx(ana));
    if (!invitation.ok) throw new Error('invitation refused');
    const token = tokenOf(invitation.url);
    expect(await households.preview(token)).toMatchObject({ householdName: 'Casa', memberCount: 1 });
    expect(await households.accept(ctx(beto), { token, displayName: 'Beto' })).toMatchObject({ ok: true });
    expect(await households.preview(token)).toBeNull();
    expect(await households.accept(ctx(outsider), { token, displayName: 'X' })).toMatchObject({ ok: false, reason: 'invalid_invitation' });
    // Members do not invite.
    expect(await households.invite(ctx(beto))).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('shares expenses with their author and adds each contribution to the member projection (HU13-HU15)', async () => {
    const rent = await households.addExpense(ctx(beto), { label: 'Arriendo', amount: 600_001, schedule: monthly });
    expect(rent.ok).toBe(true);
    const internet = await households.addExpense(ctx(ana), {
      label: 'Internet',
      amount: 30_000,
      schedule: monthly,
      rule: { mode: 'percentage', shares: [{ userId: ana as UserId, basisPoints: 2500 }, { userId: beto as UserId, basisPoints: 7500 }] },
    });
    expect(internet.ok).toBe(true);
    // A member cannot change the split rule (HU14 is configured by the admin).
    expect(await households.addExpense(ctx(beto), { label: 'Gas', amount: 1000, schedule: monthly, rule: { mode: 'assigned', userId: ana as UserId } })).toMatchObject({
      ok: false,
      reason: 'forbidden',
    });

    const view = await households.view(ctx(beto).actor);
    expect(view?.household.expenses.map((e) => [e.label, e.createdByName])).toEqual([
      ['Arriendo', 'Beto'],
      ['Internet', 'Ana'],
    ]);
    expect(view?.household.members.map((m) => m.role)).toEqual(['admin', 'member']);

    await registry.setOpeningBalance(ctx(beto), { amount: 1_000_000, month: yearMonth(2026, 11) });
    const projection = await registry.projection(ctx(beto).actor, 1);
    if (!projection.ok) throw new Error('projection refused');
    const labels = projection.state.expenses.map((e) => [e.label, e.amount]);
    // Ana joined first, so she gets the leftover peso of the equal split.
    expect(labels).toEqual([
      ['Aporte al hogar: Arriendo', 300_000],
      ['Aporte al hogar: Internet', 22_500],
    ]);
  });

  it('lets the admin and the author edit, but not other members (HU13)', async () => {
    const view = await households.view(ctx(ana).actor);
    const internet = view?.household.expenses.find((e) => e.label === 'Internet');
    if (internet === undefined) throw new Error('missing expense');
    expect(await households.updateExpense(ctx(beto), internet.id, { label: 'Fibra', amount: 30_000, schedule: monthly })).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(await households.updateExpense(ctx(ana), internet.id, { label: 'Fibra', amount: 32_000, schedule: monthly, rule: { mode: 'equal' } })).toMatchObject({ ok: true });
    expect(await households.deleteExpense(ctx(beto), internet.id)).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(await households.deleteExpense(ctx(ana), internet.id)).toMatchObject({ ok: true });
  });

  it('keeps the household invisible to outsiders and never exposes individual finances (rule 5)', async () => {
    expect(await households.view(ctx(outsider).actor)).toBeNull();
    const view = await households.view(ctx(ana).actor);
    const expenseId = view?.household.expenses[0]?.id ?? '';
    expect(await households.deleteExpense(ctx(outsider), expenseId)).toMatchObject({ ok: false, reason: 'not_found' });
    // Ana sees Beto's share of the household but not Beto's registry.
    const anaProjection = await registry.snapshot(ctx(ana).actor);
    expect(anaProjection.openingBalance).toBeNull();
  });

  it('becomes read-only when no member has a family plan in force, without deleting data (HU20)', async () => {
    await giveFamilyPlan(ana, false);
    const view = await households.view(ctx(ana).actor);
    expect(view?.household.spaceActive).toBe(false);
    expect(view?.household.expenses).toHaveLength(1);
    expect(await households.addExpense(ctx(ana), { label: 'Agua', amount: 9000, schedule: monthly })).toMatchObject({ ok: false, reason: 'read_only' });
    await giveFamilyPlan(ana, true);
    expect(await households.addExpense(ctx(ana), { label: 'Agua', amount: 9000, schedule: monthly })).toMatchObject({ ok: true });
  });

  it('lets a member leave and the admin remove members (HU12)', async () => {
    expect(await households.removeMember(ctx(beto), ana)).toMatchObject({ ok: false, reason: 'forbidden' });
    expect(await households.removeMember(ctx(beto), beto)).toMatchObject({ ok: true });
    expect(await households.view(ctx(beto).actor)).toBeNull();
    const projection = await registry.projection(ctx(beto).actor, 1);
    expect(projection).toMatchObject({ ok: true });
    expect(projection.ok ? projection.state.expenses : null).toEqual([]);
  });
});
