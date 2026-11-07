// KPI of the initial registration (section 4.1, migration 0010): started at the first registry
// write, completed with an opening balance and one income. Only dates are stored.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgRegistryStore } from '../../src/adapters/postgres/pg-registry-store.ts';
import { createPgTransactionRunner } from '../../src/adapters/postgres/pg-transaction-runner.ts';
import { yearMonth } from '../../src/core/index.ts';
import { RegistryService } from '../../src/modules/registry/application/registry-service.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import { createTestDatabase, createUser, type TestDatabase } from './harness.ts';

let db: TestDatabase;
let registry: RegistryService;

beforeAll(async () => {
  db = await createTestDatabase();
  registry = new RegistryService(createPgRegistryStore(createPgTransactionRunner(db.api)), { newId: () => randomUUID() });
});

afterAll(async () => {
  await (db as TestDatabase | undefined)?.drop();
});

const dates = async (userId: string) =>
  (await db.owner.query<{ started: Date | null; completed: Date | null }>('SELECT onboarding_started_at AS started, onboarding_completed_at AS completed FROM app.users WHERE id = $1', [userId])).rows[0];

describe('initial registration KPI', () => {
  it('starts with the first write and completes with an opening balance and an income', async () => {
    const userId = await createUser(db);
    const context = { actor: { userId: userId as UserId }, ip: '127.0.0.1' };
    expect(await dates(userId)).toEqual({ started: null, completed: null });

    await registry.createExpense(context, { label: 'Arriendo', amount: 400_000, nature: 'fixed', schedule: { kind: 'monthly', from: yearMonth(2026, 11), until: null } });
    const afterExpense = await dates(userId);
    expect(afterExpense?.started).not.toBeNull();
    expect(afterExpense?.completed).toBeNull();

    await registry.setOpeningBalance(context, { amount: 100_000, month: yearMonth(2026, 11) });
    expect((await dates(userId))?.completed).toBeNull();
    await registry.createIncome(context, { label: 'Sueldo', amount: 900_000, schedule: { kind: 'monthly', from: yearMonth(2026, 11), until: null } });
    const done = await dates(userId);
    expect(done?.completed).not.toBeNull();
    expect(done?.started?.getTime()).toBe(afterExpense?.started?.getTime());
  });
});
