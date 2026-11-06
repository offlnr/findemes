/** Tabla 14: the seven states of a subscription and their effect on access. */
export type SubscriptionState = 'gratuito' | 'pendiente' | 'activa' | 'por_vencer' | 'vencida' | 'fallida' | 'cancelada';

export type PlanCode = 'free' | 'paid' | 'family';
export type OrderStatus = 'created' | 'authorized' | 'rejected' | 'aborted' | 'amount_mismatch';

/** Days before the end of the period when the plan shows the renewal notice ("Por vencer"). */
export const RENEWAL_NOTICE_DAYS = 7;
/** A started payment is "Pendiente" while the user may still be on the Webpay form. */
export const PENDING_WINDOW_MS = 30 * 60 * 1000;

export interface SubscriptionPeriod {
  readonly planCode: Exclude<PlanCode, 'free'>;
  /** ISO dates (YYYY-MM-DD) in Chile; access lasts while today < periodEnd. */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly cancelAtPeriodEnd: boolean;
  readonly updatedAt: Date;
}

export interface PaymentOrderSummary {
  readonly buyOrder: string;
  readonly planCode: Exclude<PlanCode, 'free'>;
  readonly amount: number;
  readonly status: OrderStatus;
  readonly createdAt: Date;
  readonly committedAt: Date | null;
}

export interface PlanOffer {
  readonly code: PlanCode;
  readonly name: string;
  /** `null`: not for sale (the free plan). */
  readonly priceClp: number | null;
  readonly periodMonths: number;
  readonly maxSavedScenarios: number | null;
  readonly maxComparedScenarios: number;
  readonly fullHistory: boolean;
  readonly userPrepayments: boolean;
  readonly householdSpace: boolean;
}

const daysBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);

/**
 * Tabla 14, derived from dates and the latest order (never stored, so it cannot become stale).
 * A pending or failed payment is reported over the current plan, which keeps applying
 * ("se mantiene el plan anterior").
 */
export function subscriptionState(input: {
  readonly period: SubscriptionPeriod | null;
  readonly latestOrder: PaymentOrderSummary | null;
  /** Today in Chile, YYYY-MM-DD. */
  readonly today: string;
  readonly now: Date;
}): SubscriptionState {
  const { period, latestOrder, today, now } = input;
  if (latestOrder !== null) {
    if (latestOrder.status === 'created' && now.getTime() - latestOrder.createdAt.getTime() < PENDING_WINDOW_MS) return 'pendiente';
    const settledAfterPeriod = period === null || (latestOrder.committedAt !== null && latestOrder.committedAt > period.updatedAt);
    if (latestOrder.status === 'rejected' && settledAfterPeriod) return 'fallida';
  }
  if (period === null) return 'gratuito';
  if (period.periodEnd <= today) return 'vencida';
  if (period.cancelAtPeriodEnd) return 'cancelada';
  return daysBetween(today, period.periodEnd) <= RENEWAL_NOTICE_DAYS ? 'por_vencer' : 'activa';
}

/**
 * Webpay buy order: unique, at most 26 characters of [A-Za-z0-9_-] (migration 0005). Built from
 * random bytes, never from user data.
 */
export function buyOrderFrom(randomHex: string): string {
  return `FDM${randomHex.slice(0, 22).toUpperCase()}`;
}
