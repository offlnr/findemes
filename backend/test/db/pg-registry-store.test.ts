// PostgreSQL registry adapter under the API role: RLS, cross-access and the audit trail (HU25).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgRegistryStore } from '../../src/adapters/postgres/pg-registry-store.ts';
import { createPgTransactionRunner } from '../../src/adapters/postgres/pg-transaction-runner.ts';
import { yearMonth } from '../../src/core/index.ts';
import { RegistryService } from '../../src/modules/registry/application/registry-service.ts';
import type { UserId } from '../../src/modules/shared/actor.ts';
import { createTestDatabase, createUser, type TestDatabase } from './harness.ts';

let db: TestDatabase;
let service: RegistryService;
let ana: { actor: { userId: UserId }; ip: string };
let beto: { actor: { userId: UserId }; ip: string };

const nov = yearMonth(2026, 11);
const monthly = { kind: 'monthly', from: nov, until: null } as const;

beforeAll(async () => {
  db = await createTestDatabase();
  service = new RegistryService(createPgRegistryStore(createPgTransactionRunner(db.api)), { newId: () => randomUUID() });
  ana = { actor: { userId: (await createUser(db)) as UserId }, ip: '203.0.113.10' };
  beto = { actor: { userId: (await createUser(db)) as UserId }, ip: '203.0.113.11' };
});

afterAll(async () => {
  await (db as TestDatabase | undefined)?.drop();
});

describe('PostgreSQL registry store', () => {
  it('round-trips every schedule kind, natures and debts with their pending installments', async () => {
    await service.setOpeningBalance(ana, { amount: -25_000, month: nov });
    await service.createIncome(ana, { label: 'Sueldo', amount: 900_000, schedule: monthly });
    await service.createIncome(ana, { label: 'Bono', amount: 300_000, schedule: { kind: 'every_n_months', intervalMonths: 3, from: nov, until: yearMonth(2027, 11) } });
    await service.createIncome(ana, { label: 'Venta', amount: 50_000, schedule: { kind: 'once', month: yearMonth(2027, 1) } });
    await service.createExpense(ana, { label: 'Supermercado', amount: 250_000, nature: 'variable_estimate', schedule: monthly });
    await service.createDebt(ana, { label: 'Crédito', installmentAmount: 120_000, pendingInstallments: 3, nextInstallmentMonth: yearMonth(2026, 12), totalInstallments: 12 });

    const snapshot = await service.snapshot(ana.actor);
    expect(snapshot.openingBalance).toEqual({ amount: -25_000, month: nov });
    expect(snapshot.incomes.map((i) => i.schedule)).toEqual([
      monthly,
      { kind: 'every_n_months', intervalMonths: 3, from: nov, until: yearMonth(2027, 11) },
      { kind: 'once', month: yearMonth(2027, 1) },
    ]);
    expect(snapshot.expenses[0]).toMatchObject({ nature: 'variable_estimate', amount: 250_000 });
    expect(snapshot.debts[0]?.installments.map((i) => i.month)).toEqual([yearMonth(2026, 12), yearMonth(2027, 1), yearMonth(2027, 2)]);
    expect(snapshot.debts[0]?.totalInstallments).toBe(12);

    const projection = await service.projection(ana.actor, 4);
    // nov: -25.000 + 900.000 + 300.000 (bono) - 250.000; dic: + 650.000 - 120.000;
    // ene: same + 50.000 (venta); feb: same + 300.000 (bono trimestral).
    expect(projection.ok && projection.result.base.projection.months.map((m) => m.closingBalance)).toEqual([925_000, 1_455_000, 2_035_000, 2_865_000]);
  });

  it('keeps another user’s records invisible and untouchable (rule 5)', async () => {
    const income = await service.createIncome(ana, { label: 'Privado', amount: 1_000, schedule: monthly });
    const debt = await service.createDebt(ana, { label: 'Privada', installmentAmount: 1_000, pendingInstallments: 1, nextInstallmentMonth: nov, totalInstallments: null });
    if (!income.ok || !debt.ok) throw new Error('not created');

    const seenByBeto = await service.snapshot(beto.actor);
    expect(seenByBeto).toEqual({ openingBalance: null, incomes: [], expenses: [], debts: [] });
    expect(await service.updateIncome(beto, income.id, { label: 'x', amount: 1, schedule: monthly })).toEqual({ ok: false, reason: 'not_found' });
    expect(await service.deleteIncome(beto, income.id)).toBe(false);
    expect(await service.updateDebt(beto, debt.id, { label: 'x', installmentAmount: 1, pendingInstallments: 1, nextInstallmentMonth: nov, totalInstallments: null })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await service.deleteDebt(beto, debt.id)).toBe(false);

    const stillThere = await service.snapshot(ana.actor);
    expect(stillThere.incomes.some((i) => i.id === income.id)).toBe(true);
    expect(stillThere.debts.some((d) => d.id === debt.id)).toBe(true);
  });

  it('replaces the pending schedule when a debt is edited, and deletes its installments with it', async () => {
    const debt = await service.createDebt(ana, { label: 'Tarjeta', installmentAmount: 50_000, pendingInstallments: 4, nextInstallmentMonth: nov, totalInstallments: null });
    if (!debt.ok) throw new Error('not created');
    await service.updateDebt(ana, debt.id, { label: 'Tarjeta', installmentAmount: 40_000, pendingInstallments: 2, nextInstallmentMonth: nov, totalInstallments: null });
    const edited = (await service.snapshot(ana.actor)).debts.find((d) => d.id === debt.id);
    expect(edited?.installments).toEqual([
      { month: nov, amount: 40_000 },
      { month: yearMonth(2026, 12), amount: 40_000 },
    ]);

    expect(await service.deleteDebt(ana, debt.id)).toBe(true);
    const { rows } = await db.owner.query('SELECT 1 FROM app.debt_installments WHERE debt_id = $1', [debt.id]);
    expect(rows).toHaveLength(0);
  });

  it('records every change in the hash-chained audit trail, without amounts (HU25)', async () => {
    const { rows } = await db.owner.query<{ action: string; actor_id: string; origin_ip: string; details: object }>(
      `SELECT action, actor_id, host(origin_ip) AS origin_ip, details FROM app.audit_log WHERE actor_id = $1 ORDER BY seq`,
      [ana.actor.userId],
    );
    expect(rows.map((r) => r.action)).toContain('registry.opening_balance_set');
    expect(rows.map((r) => r.action)).toContain('registry.debt_deleted');
    expect(rows.every((r) => r.origin_ip === ana.ip && JSON.stringify(r.details) === '{}')).toBe(true);

    const { rows: chain } = await db.owner.query<{ broken: string | null }>('SELECT app.verify_audit_chain() AS broken');
    expect(chain[0]?.broken).toBeNull();
  });

  it('gives the administration role no read access to financial data (HU23)', async () => {
    await expect(db.admin.query('SELECT * FROM app.incomes')).rejects.toMatchObject({ code: '42501' });
  });
});
