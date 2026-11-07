// PostgreSQL scenarios and plan reader under the API role: plan limits enforced by the database,
// cross-access and audit (HU06-HU11, Tabla 13, HU25).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgRegistryStore } from '../../src/adapters/postgres/pg-registry-store.ts';
import { createPgPlanReader, createPgScenarioStore } from '../../src/adapters/postgres/pg-scenario-store.ts';
import { createPgTransactionRunner } from '../../src/adapters/postgres/pg-transaction-runner.ts';
import { yearMonth } from '../../src/core/index.ts';
import { RegistryService } from '../../src/modules/registry/application/registry-service.ts';
import { ScenarioService } from '../../src/modules/scenarios/application/scenario-service.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import { createTestDatabase, createUser, type TestDatabase } from './harness.ts';

let db: TestDatabase;
let scenarios: ScenarioService;
let ana: { actor: { userId: UserId }; ip: string };
let beto: { actor: { userId: UserId }; ip: string };
const nov = yearMonth(2026, 11);
const repair = { kind: 'one_off_expense', params: { label: 'Reparación', amount: 500_000, month: '2026-12' } };

beforeAll(async () => {
  db = await createTestDatabase();
  const runner = createPgTransactionRunner(db.api);
  const registryStore = createPgRegistryStore(runner);
  const ids = { newId: () => randomUUID() };
  scenarios = new ScenarioService({ scenarios: createPgScenarioStore(runner), registry: registryStore, plans: createPgPlanReader(runner), ids });
  ana = { actor: { userId: (await createUser(db)) as UserId }, ip: '203.0.113.20' };
  beto = { actor: { userId: (await createUser(db)) as UserId }, ip: '203.0.113.21' };
  const registry = new RegistryService(registryStore, ids);
  for (const user of [ana, beto]) {
    await registry.setOpeningBalance(user, { amount: 200_000, month: nov });
    await registry.createIncome(user, { label: 'Sueldo', amount: 1_000_000, schedule: { kind: 'monthly', from: nov, until: null } });
  }
});

afterAll(async () => {
  await (db as TestDatabase | undefined)?.drop();
});

describe('PostgreSQL scenarios', () => {
  it('stores only the name and the raw decisions, and simulates them against the registry', async () => {
    const created = await scenarios.create(ana, { name: 'Arreglar el auto', decisions: [repair] });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const { rows } = await db.owner.query<{ decisions: unknown }>('SELECT decisions FROM app.scenarios WHERE id = $1', [created.id]);
    expect(rows[0]?.decisions).toEqual([repair]);

    const view = await scenarios.view(ana.actor, created.id, 2);
    // The balance grows every month, so the one-off expense shows in December's margin.
    expect(view.ok && view.view.result.variation.monthlyAvailableMargin.map((m) => m.amount)).toEqual([0, -500_000]);
  });

  it('enforces the free plan limit in the database (Tabla 13)', async () => {
    const second = await scenarios.create(ana, { name: 'Dos', decisions: [] });
    const third = await scenarios.create(ana, { name: 'Tres', decisions: [] });
    expect(second.ok).toBe(true);
    expect(!third.ok && third.reason).toBe('plan_limit');
  });

  it('reads the paid plan while its period lasts', async () => {
    await db.owner.query(
      `INSERT INTO app.subscriptions (user_id, plan_code, period_start, period_end)
       VALUES ($1, 'paid', current_date - 1, current_date + 30)`,
      [beto.actor.userId],
    );
    const { plan } = await scenarios.list(beto.actor);
    expect(plan).toMatchObject({ code: 'paid', maxSavedScenarios: null, maxComparedScenarios: 5, userPrepayments: true });
    for (let i = 0; i < 3; i++) {
      expect((await scenarios.create(beto, { name: `Escenario ${String(i)}`, decisions: [] })).ok).toBe(true);
    }
  });

  it('keeps scenarios individual: another user cannot see, edit or delete them (rule 5)', async () => {
    const { scenarios: own } = await scenarios.list(ana.actor);
    const target = own[0];
    if (target === undefined) throw new Error('no scenario');
    expect((await scenarios.list(beto.actor)).scenarios.some((s) => s.id === target.id)).toBe(false);
    expect(await scenarios.view(beto.actor, target.id, 2)).toEqual({ ok: false, reason: 'not_found' });
    expect(await scenarios.update(beto, target.id, { name: 'x', decisions: [] })).toEqual({ ok: false, reason: 'not_found' });
    expect(await scenarios.delete(beto, target.id)).toBe(false);
  });

  it('audits creations and deletions without values (HU25)', async () => {
    const { scenarios: own } = await scenarios.list(ana.actor);
    const target = own[0];
    if (target === undefined) throw new Error('no scenario');
    expect(await scenarios.delete(ana, target.id)).toBe(true);
    const { rows } = await db.owner.query<{ action: string }>(
      `SELECT action FROM app.audit_log WHERE target_id = $1 ORDER BY seq`,
      [target.id],
    );
    expect(rows.map((r) => r.action)).toEqual(['scenario.created', 'scenario.deleted']);
  });
});
