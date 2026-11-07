import type { Actor, UserId } from '../../shared/actor.ts';
import type { Clock, WriteContext } from '../../shared/ports.ts';
import { buyOrderFrom, subscriptionState, type PaymentOrderSummary, type PlanCode, type PlanOffer, type SubscriptionPeriod, type SubscriptionState } from '../domain/subscription.ts';
import type {
  PaymentGateway,
  PaymentSettlement,
  PlanCapabilities,
  PlanReader,
  SubscriptionCanceller,
  SubscriptionStore,
} from '../ports/subscription-ports.ts';

export interface SubscriptionDeps {
  readonly store: SubscriptionStore;
  readonly settlement: PaymentSettlement;
  readonly canceller: SubscriptionCanceller;
  readonly gateway: PaymentGateway;
  readonly plans: PlanReader;
  readonly clock: Clock;
  /** 32 random hex characters for a new buy order. */
  readonly randomHex: () => string;
  /** Public URL of this API, where Webpay sends the browser back. */
  readonly apiPublicUrl: string;
}

export interface SubscriptionStatus {
  readonly plan: PlanCapabilities;
  readonly state: SubscriptionState;
  readonly period: SubscriptionPeriod | null;
  readonly latestOrder: PaymentOrderSummary | null;
}

/** What the browser is told after Webpay; the plan is activated by the backend, never by this. */
export type ReturnOutcome = 'aprobado' | 'rechazado' | 'anulado' | 'en_revision' | 'pendiente';

/** Parameters Webpay Plus sends back (normal, aborted by the user, and timeout flows). */
export interface WebpayReturn {
  readonly token_ws?: string;
  readonly TBK_TOKEN?: string;
  readonly TBK_ORDEN_COMPRA?: string;
  readonly TBK_ID_SESION?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WEBPAY_RETURN_PATH = '/v1/payments/webpay/return';

/**
 * Plans and payments (Tabla 13, Tabla 14, HU18-HU20, HU30). Webpay processes the card; the plan
 * is activated only after the backend commits the transaction with Transbank, once per order
 * (rule 6). The browser return only tells the user what happened.
 */
export class SubscriptionService {
  private readonly deps: SubscriptionDeps;

  constructor(deps: SubscriptionDeps) {
    this.deps = deps;
  }

  /** HU18, HU30: public comparison of plans. */
  offers(): Promise<readonly PlanOffer[]> {
    return this.deps.store.listPlans();
  }

  async status(actor: Actor): Promise<SubscriptionStatus> {
    const [plan, period, latestOrder, today] = await Promise.all([
      this.deps.plans.capabilitiesFor(actor),
      this.deps.store.currentPeriod(actor),
      this.deps.store.latestOrder(actor),
      this.deps.store.todayInChile(),
    ]);
    return { plan, period, latestOrder, state: subscriptionState({ period, latestOrder, today, now: this.deps.clock.now() }) };
  }

  /** HU19: starts a Webpay Plus transaction and returns where to send the browser. */
  async checkout(context: WriteContext, planCode: PlanCode): Promise<{ ok: true; redirectUrl: string; buyOrder: string } | { ok: false; reason: 'not_for_sale' }> {
    if (planCode === 'free') return { ok: false, reason: 'not_for_sale' };
    const buyOrder = buyOrderFrom(this.deps.randomHex());
    const order = await this.deps.store.createOrder(context, buyOrder, planCode);
    if (order === null) return { ok: false, reason: 'not_for_sale' };
    // session_id carries the user id so a timeout return (no token) can be matched to the order.
    const started = await this.deps.gateway.start(buyOrder, context.actor.userId, order.amount, `${this.deps.apiPublicUrl}${WEBPAY_RETURN_PATH}`);
    await this.deps.store.attachProviderToken(context, buyOrder, started.token);
    return { ok: true, buyOrder, redirectUrl: `${started.redirectUrl}?token_ws=${encodeURIComponent(started.token)}` };
  }

  /**
   * Webpay return. Normal flow: `token_ws` → commit with Transbank → settle. Aborted by the user:
   * `TBK_TOKEN` → the order is marked aborted without calling commit. Timeout: only the buy order
   * and session → aborted. Repeated returns are harmless: settling is idempotent.
   */
  async handleReturn(params: WebpayReturn): Promise<ReturnOutcome> {
    const { settlement, store, gateway } = this.deps;
    if (params.TBK_TOKEN !== undefined) {
      const order = await store.findOrderByToken(params.TBK_TOKEN);
      if (order === null) return 'anulado';
      await settlement.settle(order.userId, order.buyOrder, { status: 'aborted', responseCode: 'TBK_ABORTED' });
      return 'anulado';
    }
    if (params.token_ws !== undefined) {
      const order = await store.findOrderByToken(params.token_ws);
      if (order === null) return 'pendiente';
      if (order.status !== 'created') return outcomeOfStatus(order.status);
      const committed = await gateway.commit(params.token_ws);
      if (committed.status === 'already_committed') {
        const again = await store.findOrderByToken(params.token_ws);
        return again === null ? 'pendiente' : outcomeOfStatus(again.status);
      }
      // The provider must confirm the same order this token was issued for.
      if (committed.buyOrder !== order.buyOrder) return 'en_revision';
      const result =
        committed.status === 'authorized'
          ? await settlement.settle(order.userId, order.buyOrder, { status: 'authorized', amount: committed.amount, responseCode: committed.responseCode })
          : await settlement.settle(order.userId, order.buyOrder, { status: 'rejected', responseCode: committed.responseCode });
      switch (result) {
        case 'activated':
        case 'already_activated':
          return 'aprobado';
        case 'amount_mismatch':
          return 'en_revision';
        case 'rejected':
          return 'rechazado';
        case 'aborted':
          return 'anulado';
        case 'already_settled':
        case 'unknown_order':
          return 'pendiente';
      }
    }
    if (params.TBK_ORDEN_COMPRA !== undefined && params.TBK_ID_SESION !== undefined && UUID.test(params.TBK_ID_SESION)) {
      // The database only aborts an order that is still open and belongs to that user.
      await settlement.settle(params.TBK_ID_SESION as UserId, params.TBK_ORDEN_COMPRA, { status: 'aborted', responseCode: 'TBK_TIMEOUT' });
      return 'anulado';
    }
    return 'pendiente';
  }

  /** Tabla 14 "Cancelada": access lasts until the end of the paid period. */
  cancelRenewal(actor: Actor): Promise<boolean> {
    return this.deps.canceller.cancelRenewal(actor.userId);
  }
}

function outcomeOfStatus(status: string): ReturnOutcome {
  switch (status) {
    case 'authorized':
      return 'aprobado';
    case 'rejected':
      return 'rechazado';
    case 'aborted':
      return 'anulado';
    case 'amount_mismatch':
      return 'en_revision';
    default:
      return 'pendiente';
  }
}
