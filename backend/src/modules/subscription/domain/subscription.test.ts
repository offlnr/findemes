import { describe, expect, it } from 'vitest';
import { buyOrderFrom, subscriptionState, type PaymentOrderSummary, type SubscriptionPeriod } from './subscription.ts';

const now = new Date('2026-11-06T15:00:00Z');
const today = '2026-11-06';
const period = (periodEnd: string, cancelAtPeriodEnd = false): SubscriptionPeriod => ({
  planCode: 'paid',
  periodStart: '2026-10-20',
  periodEnd,
  cancelAtPeriodEnd,
  updatedAt: new Date('2026-10-20T12:00:00Z'),
});
const order = (status: PaymentOrderSummary['status'], createdAt: string, committedAt: string | null = null): PaymentOrderSummary => ({
  buyOrder: 'FDM1',
  planCode: 'paid',
  amount: 5990,
  status,
  createdAt: new Date(createdAt),
  committedAt: committedAt === null ? null : new Date(committedAt),
});
const state = (p: SubscriptionPeriod | null, o: PaymentOrderSummary | null = null) => subscriptionState({ period: p, latestOrder: o, today, now });

describe('subscriptionState (Tabla 14)', () => {
  it('covers the seven states', () => {
    expect(state(null)).toBe('gratuito');
    expect(state(period('2026-12-20'))).toBe('activa');
    expect(state(period('2026-11-12'))).toBe('por_vencer');
    expect(state(period('2026-11-06'))).toBe('vencida');
    expect(state(period('2026-12-20', true))).toBe('cancelada');
    expect(state(null, order('created', '2026-11-06T14:50:00Z'))).toBe('pendiente');
    expect(state(null, order('rejected', '2026-11-06T14:00:00Z', '2026-11-06T14:05:00Z'))).toBe('fallida');
  });

  it('keeps the current plan state once a pending payment is abandoned or an old rejection is superseded', () => {
    expect(state(period('2026-12-20'), order('created', '2026-11-06T10:00:00Z'))).toBe('activa');
    expect(state(period('2026-12-20'), order('rejected', '2026-10-01T10:00:00Z', '2026-10-01T10:05:00Z'))).toBe('activa');
    expect(state(period('2026-12-20'), order('aborted', '2026-11-06T14:00:00Z', '2026-11-06T14:01:00Z'))).toBe('activa');
  });
});

describe('buyOrderFrom', () => {
  it('fits the Webpay limit of 26 characters', () => {
    const order = buyOrderFrom('0123456789abcdef0123456789abcdef');
    expect(order).toMatch(/^[A-Za-z0-9_-]{1,26}$/);
    expect(order).toHaveLength(25);
  });
});
