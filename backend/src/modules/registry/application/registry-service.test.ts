import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryRegistry } from '../../../../test/support/in-memory-registry.ts';
import { yearMonth } from '../../../core/index.ts';
import type { UserId } from '../../shared/actor.ts';
import { RegistryService } from './registry-service.ts';

const nov = yearMonth(2026, 11);
const ana = { actor: { userId: 'a1b2c3d4-0000-4000-8000-000000000001' as UserId }, ip: '203.0.113.1' };
const beto = { actor: { userId: 'a1b2c3d4-0000-4000-8000-000000000002' as UserId }, ip: '203.0.113.2' };
const monthly = { kind: 'monthly', from: nov, until: null } as const;

let env: ReturnType<typeof createInMemoryRegistry>;
let service: RegistryService;

beforeEach(() => {
  env = createInMemoryRegistry();
  service = new RegistryService(env.repository, env.ids);
});

describe('registry (HU01-HU04)', () => {
  it('needs the opening balance before projecting (HU04)', async () => {
    expect(await service.projection(ana.actor)).toEqual({ ok: false, reason: 'opening_balance_required' });
  });

  it('projects the registered state, with debts that end on their own (HU03, HU05, HU39)', async () => {
    await service.setOpeningBalance(ana, { amount: -50_000, month: nov });
    await service.createIncome(ana, { label: 'Sueldo', amount: 900_000, schedule: monthly });
    await service.createExpense(ana, { label: 'Arriendo', amount: 600_000, nature: 'fixed', schedule: monthly });
    await service.createDebt(ana, { label: 'Tarjeta', installmentAmount: 150_000, pendingInstallments: 2, nextInstallmentMonth: nov, totalInstallments: 6 });

    const projection = await service.projection(ana.actor, 4);
    if (!projection.ok) throw new Error(projection.reason);
    // -50.000 + 150.000 (nov, dic) then + 300.000 when the debt ends.
    expect(projection.result.base.projection.months.map((m) => m.closingBalance)).toEqual([100_000, 250_000, 550_000, 850_000]);
    expect(projection.result.base.indicators.debtToIncome.map((m) => m.basisPoints)).toEqual([1_667, 1_667, 0, 0]);
    expect(projection.result.explanation.summary).toMatch(/^El saldo proyectado se mantiene en cero o más/);
  });

  it('reflects edits and deletions immediately, without manual recalculation (HU02, HU05)', async () => {
    await service.setOpeningBalance(ana, { amount: 0, month: nov });
    const rent = await service.createExpense(ana, { label: 'Arriendo', amount: 100_000, nature: 'fixed', schedule: monthly });
    if (!rent.ok) throw new Error('not created');

    await service.updateExpense(ana, rent.id, { label: 'Arriendo', amount: 200_000, nature: 'fixed', schedule: monthly });
    let projection = await service.projection(ana.actor, 1);
    expect(projection.ok && projection.result.base.projection.months[0]?.expenses).toBe(200_000);

    await service.deleteExpense(ana, rent.id);
    projection = await service.projection(ana.actor, 1);
    expect(projection.ok && projection.result.base.projection.months[0]?.expenses).toBe(0);
  });

  it('validates positive amounts, names and periodicity without echoing values (HU01)', async () => {
    const result = await service.createIncome(ana, { label: ' ', amount: -10, schedule: { kind: 'every_n_months', intervalMonths: 1, from: nov, until: null } });
    expect(result).toEqual({
      ok: false,
      reason: 'invalid',
      issues: [
        { field: 'label', message: 'Ingresa un nombre de hasta 80 caracteres.' },
        { field: 'amount', message: 'El monto debe ser un número entero de pesos mayor que cero.' },
        { field: 'schedule.intervalMonths', message: 'La periodicidad debe ser cada 2 a 24 meses.' },
      ],
    });
  });

  it('validates the HU03 debt input', async () => {
    const result = await service.createDebt(ana, { label: 'Crédito', installmentAmount: 10_000, pendingInstallments: 0, nextInstallmentMonth: nov, totalInstallments: null });
    expect(!result.ok && result.reason === 'invalid' && result.issues.map((i) => i.field)).toEqual(['pendingInstallments']);
  });

  it('accepts a negative opening balance (HU04)', async () => {
    expect((await service.setOpeningBalance(ana, { amount: -1_234_567, month: nov })).ok).toBe(true);
  });
});

describe('individual privacy (rule 5)', () => {
  it('never shows, edits or deletes another user’s records', async () => {
    const income = await service.createIncome(ana, { label: 'Sueldo', amount: 900_000, schedule: monthly });
    if (!income.ok) throw new Error('not created');

    expect((await service.snapshot(beto.actor)).incomes).toEqual([]);
    expect(await service.updateIncome(beto, income.id, { label: 'Robado', amount: 1, schedule: monthly })).toEqual({ ok: false, reason: 'not_found' });
    expect(await service.deleteIncome(beto, income.id)).toBe(false);
    expect((await service.snapshot(ana.actor)).incomes[0]?.label).toBe('Sueldo');
  });
});

describe('audit trail (HU25)', () => {
  it('records each change with account, action, target and origin, never amounts', async () => {
    const income = await service.createIncome(ana, { label: 'Sueldo', amount: 900_000, schedule: monthly });
    if (!income.ok) throw new Error('not created');
    await service.deleteIncome(ana, income.id);

    expect(env.audit).toEqual([
      { actorId: ana.actor.userId, action: 'registry.income_created', targetId: income.id, ip: ana.ip },
      { actorId: ana.actor.userId, action: 'registry.income_deleted', targetId: income.id, ip: ana.ip },
    ]);
    expect(JSON.stringify(env.audit)).not.toContain('900000');
  });
});
