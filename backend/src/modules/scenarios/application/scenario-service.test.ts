import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryRegistry } from '../../../../test/support/in-memory-registry.ts';
import { createInMemoryScenarios, PAID_PLAN } from '../../../../test/support/in-memory-scenarios.ts';
import { yearMonth } from '../../../core/index.ts';
import { RegistryService } from '../../registry/application/registry-service.ts';
import type { UserId } from '../../shared/actor.ts';
import { ScenarioService } from './scenario-service.ts';

const nov = yearMonth(2026, 11);
const ana = { actor: { userId: 'a1b2c3d4-0000-4000-8000-000000000001' as UserId }, ip: '203.0.113.1' };
const beto = { actor: { userId: 'a1b2c3d4-0000-4000-8000-000000000002' as UserId }, ip: '203.0.113.2' };
const monthly = { kind: 'monthly', from: nov, until: null } as const;

const repair = { kind: 'one_off_expense', params: { label: 'Reparación', amount: 500_000, month: '2026-12' } };

let registry: ReturnType<typeof createInMemoryRegistry>;
let scenarios: ReturnType<typeof createInMemoryScenarios>;
let service: ScenarioService;
let debtId: string;

beforeEach(async () => {
  registry = createInMemoryRegistry();
  scenarios = createInMemoryScenarios();
  service = new ScenarioService({ scenarios: scenarios.repository, registry: registry.repository, plans: scenarios.planReader, ids: registry.ids });
  const records = new RegistryService(registry.repository, registry.ids);
  // Balanced budget: the balance stays at 200.000 every month.
  await records.setOpeningBalance(ana, { amount: 200_000, month: nov });
  await records.createIncome(ana, { label: 'Sueldo', amount: 1_000_000, schedule: monthly });
  await records.createExpense(ana, { label: 'Arriendo', amount: 900_000, nature: 'fixed', schedule: monthly });
  const debt = await records.createDebt(ana, { label: 'Crédito', installmentAmount: 100_000, pendingInstallments: 5, nextInstallmentMonth: nov, totalInstallments: null });
  debtId = debt.ok ? debt.id : '';
});

async function created(input: { name: string; decisions: { kind: string; params: unknown }[] }, context = ana) {
  const result = await service.create(context, input);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.id;
}

describe('scenarios (HU06-HU08, HU10, HU11)', () => {
  it('simulates a scenario against the unchanged base, with variation and explanation', async () => {
    const id = await created({ name: 'Arreglar el auto', decisions: [repair] });
    const view = await service.view(ana.actor, id, 3);
    if (!view.ok) throw new Error(view.reason);

    expect(view.view.result.base.projection.months.map((m) => m.closingBalance)).toEqual([200_000, 200_000, 200_000]);
    expect(view.view.result.scenario.projection.months.map((m) => m.closingBalance)).toEqual([200_000, -300_000, -300_000]);
    expect(view.view.result.variation.minimumProjectedBalance).toBe(-500_000);
    expect(view.view.result.explanation.summary).toMatch(/^Con la decisión aplicada/);
  });

  it('never modifies the registry (rule 3)', async () => {
    const before = JSON.stringify(await registry.repository.load(ana.actor));
    await created({ name: 'Arreglar el auto', decisions: [repair] });
    expect(JSON.stringify(await registry.repository.load(ana.actor))).toBe(before);
  });

  it('renames, changes decisions and deletes without touching other scenarios (HU11)', async () => {
    const a = await created({ name: 'A', decisions: [repair] });
    const b = await created({ name: 'B', decisions: [] });
    expect(await service.update(ana, a, { name: 'A renombrado', decisions: [] })).toEqual({ ok: true, id: a });
    expect(await service.delete(ana, a)).toBe(true);
    const { scenarios: left } = await service.list(ana.actor);
    expect(left.map((s) => [s.id, s.name])).toEqual([[b, 'B']]);
  });

  it('rejects decisions the engine does not accept, by position', async () => {
    const result = await service.create(ana, { name: 'Mal', decisions: [repair, { kind: 'one_off_expense', params: { label: 'x', amount: 0, month: '2026-12' } }] });
    expect(result).toEqual({
      ok: false,
      reason: 'invalid_decisions',
      issues: [{ decisionIndex: 1, issues: [{ field: 'amount', message: 'El monto debe ser mayor que cero.' }] }],
    });
  });

  it('needs the opening balance first', async () => {
    expect(await service.create(beto, { name: 'Sin base', decisions: [] })).toEqual({ ok: false, reason: 'opening_balance_required' });
  });
});

describe('plan limits (Tabla 13)', () => {
  it('lets the free plan save two scenarios', async () => {
    await created({ name: 'Uno', decisions: [] });
    await created({ name: 'Dos', decisions: [] });
    const third = await service.create(ana, { name: 'Tres', decisions: [] });
    expect(third).toEqual({
      ok: false,
      reason: 'plan_limit',
      message: 'El plan Gratuito permite guardar hasta 2 escenarios. Elimina uno o cambia de plan para guardar otro.',
    });
  });

  it('keeps debt prepayments for paid plans', async () => {
    const prepay = { kind: 'debt_prepayment', params: { debtId, amount: 200_000, month: '2026-11' } };
    expect(await service.create(ana, { name: 'Prepago', decisions: [prepay] })).toEqual({
      ok: false,
      reason: 'plan_limit',
      message: 'La simulación de prepagos de deuda no está incluida en el plan Gratuito.',
    });
    scenarios.setPlan(ana.actor.userId, PAID_PLAN);
    expect((await service.create(ana, { name: 'Prepago', decisions: [prepay] })).ok).toBe(true);
  });

  it('compares one scenario against the base on the free plan, more on paid plans, in the given order (HU09)', async () => {
    const a = await created({ name: 'A', decisions: [repair] });
    const b = await created({ name: 'B', decisions: [] });

    const one = await service.compare(ana.actor, [a], 3);
    expect(one.ok && one.view.scenarios.map((s) => s.scenario.name)).toEqual(['A']);
    expect(await service.compare(ana.actor, [a, b], 3)).toEqual({ ok: false, reason: 'plan_limit', message: 'El plan Gratuito compara un escenario frente a la base.' });

    scenarios.setPlan(ana.actor.userId, PAID_PLAN);
    const both = await service.compare(ana.actor, [b, a], 3);
    // Order as requested, never ranked by result (rule 4).
    expect(both.ok && both.view.scenarios.map((s) => s.scenario.name)).toEqual(['B', 'A']);
  });
});

describe('individual privacy (rule 5) and audit (HU25)', () => {
  it('treats another user’s scenario as nonexistent', async () => {
    const id = await created({ name: 'Privado', decisions: [] });
    expect(await service.view(beto.actor, id, 3)).toEqual({ ok: false, reason: 'not_found' });
    expect(await service.update(beto, id, { name: 'x', decisions: [] })).toEqual({ ok: false, reason: 'not_found' });
    expect(await service.delete(beto, id)).toBe(false);
    expect(await service.compare(beto.actor, [id], 3)).toEqual({ ok: false, reason: 'not_found' });
  });

  it('audits every change', async () => {
    const id = await created({ name: 'A', decisions: [] });
    await service.delete(ana, id);
    expect(scenarios.audit.map((e) => e.action)).toEqual(['scenario.created', 'scenario.deleted']);
  });
});
