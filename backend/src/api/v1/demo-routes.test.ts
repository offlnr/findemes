import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPublicApi } from '../build-public-api.ts';
import { DEMO_RATE_LIMIT } from './demo-routes.ts';

interface Outcome {
  months: { closingBalance: number }[];
  indicators: { breakMonth: string | null; debtToIncome: { month: string; basisPoints: number | null }[] };
}

interface ProjectionBody {
  origin: string;
  startMonth: string;
  horizonMonths: number;
  entries: { debts: { id: string }[] };
  base: Outcome;
  scenario: Outcome | null;
  variation: { minimumProjectedBalance: number; breakMonth: { base: string | null; scenario: string | null } } | null;
  explanation: { summary: string; details: string[] };
  limitNotice: string;
}

const closings = (outcome: Outcome | null | undefined) => outcome?.months.map((m) => m.closingBalance);

const ownData = { openingBalance: 100_000, monthlyIncome: 800_000, monthlyFixedExpense: 600_000 };
const repair = { kind: 'one_off_expense', params: { label: 'Reparación', amount: 1_000_000, month: '2026-12' } };

describe('demo routes (HU27, HU28)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildPublicApi({ logger: false, clock: { now: () => new Date('2026-11-15T12:00:00Z') } });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (payload: unknown, ip = '203.0.113.1') =>
    app.inject({ method: 'POST', url: '/v1/demo/projection', payload: payload as object, remoteAddress: ip });

  it('lists the fictitious examples', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/demo/examples' });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ id: string }[]>().map((example) => example.id)).toEqual(['estudiante', 'familia', 'profesional']);
  });

  it('projects three months of the visitor’s own data with one decision, labeled as demo', async () => {
    const response = await post({ base: ownData, decision: repair });
    expect(response.statusCode).toBe(200);
    const body = response.json<ProjectionBody>();

    expect(body.origin).toBe('demo');
    expect(body.startMonth).toBe('2026-11');
    expect(body.horizonMonths).toBe(3);
    expect(closings(body.base)).toEqual([300_000, 500_000, 700_000]);
    expect(closings(body.scenario)).toEqual([300_000, -500_000, -300_000]);
    expect(body.scenario?.indicators.breakMonth).toBe('2026-12');
    expect(body.variation?.minimumProjectedBalance).toBe(-800_000);
    expect(body.variation?.breakMonth).toEqual({ base: null, scenario: '2026-12' });
    expect(body.explanation.summary).toBe(
      'Con la decisión aplicada, el saldo mínimo proyectado es -$500.000 en diciembre de 2026, frente a $300.000 sin ella (-$800.000).',
    );
    expect(body.limitNotice).toMatch(/Con una cuenta/);
  });

  it('projects a preloaded example over twelve months and exposes the ids decisions can refer to', async () => {
    const response = await post({ base: { example: 'familia' }, decision: null });
    expect(response.statusCode).toBe(200);
    const body = response.json<ProjectionBody>();

    expect(body.horizonMonths).toBe(12);
    expect(body.scenario).toBeNull();
    expect(body.variation).toBeNull();
    expect(body.entries.debts.map((debt) => debt.id)).toEqual(['credito-automotriz']);
    expect(body.base.indicators.debtToIncome[0]).toEqual({ month: '2026-11', basisPoints: 1913 });
  });

  it('simulates a prepayment on an example debt', async () => {
    const response = await post({
      base: { example: 'familia' },
      decision: { kind: 'debt_prepayment', params: { debtId: 'credito-automotriz', amount: 440_000, month: '2026-11' } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<ProjectionBody>().explanation.details[0]).toMatch(/modalidad «reducir plazo»/);
  });

  it('answers 422 with neutral field messages when the engine rejects the decision', async () => {
    const response = await post({ base: ownData, decision: { kind: 'one_off_expense', params: { label: 'x', amount: 0, month: '2026-12' } } });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: 'invalid_decision',
      message: 'La decisión no es válida.',
      issues: [{ field: 'amount', message: 'El monto debe ser mayor que cero.' }],
    });
  });

  it('accepts at most the HU28 data: rejects extra fields, a second decision and string amounts', async () => {
    const extraField = await post({ base: { ...ownData, monthlyDebt: 10_000 } });
    const twoDecisions = await post({ base: ownData, decision: [repair, repair] });
    const stringAmount = await post({ base: { ...ownData, monthlyIncome: '800000' } });
    const unknownKind = await post({ base: ownData, decision: { kind: 'lottery_win', params: {} } });
    const unknownExample = await post({ base: { example: 'millonario' } });

    for (const response of [extraField, twoDecisions, stringAmount, unknownKind, unknownExample]) {
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: string }>().error).toBe('validation_error');
    }
  });

  it('never echoes the submitted amounts in a validation error', async () => {
    const response = await post({ base: { ...ownData, monthlyIncome: 987_654_321_987_654 } });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('987654321987654');
  });

  it('limits the number of requests per client IP', async () => {
    const ip = '198.51.100.7';
    for (let i = 0; i < DEMO_RATE_LIMIT.max; i++) {
      expect((await post({ base: ownData }, ip)).statusCode).toBe(200);
    }
    const limited = await post({ base: ownData }, ip);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'too_many_requests', message: 'Se alcanzó el límite de solicitudes. Intenta más tarde.' });
    expect((await post({ base: ownData }, '198.51.100.8')).statusCode).toBe(200);
  });
});
