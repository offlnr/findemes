import type { Clp } from '../../../core/index.ts';
import type { Actor, UserId } from '../../shared/actor.ts';
import type { WriteContext } from '../../shared/ports.ts';
import type { PaymentOrderSummary, PlanCode, PlanOffer, SubscriptionPeriod } from '../domain/subscription.ts';

export interface PaymentStart {
  readonly token: string;
  readonly redirectUrl: string;
}

export type PaymentCommitResult =
  | { readonly status: 'authorized'; readonly buyOrder: string; readonly amount: Clp; readonly responseCode: string }
  | { readonly status: 'rejected'; readonly buyOrder: string; readonly responseCode: string }
  /** The provider reports the token was already committed (repeated return or retry). */
  | { readonly status: 'already_committed'; readonly buyOrder: string };

/**
 * Payment provider (Webpay Plus, integration environment). No card data ever passes through
 * this port. Aborted flows are detected on return by `TBK_TOKEN` without calling `commit`.
 */
export interface PaymentGateway {
  start(buyOrder: string, sessionId: string, amount: Clp, returnUrl: string): Promise<PaymentStart>;
  commit(token: string): Promise<PaymentCommitResult>;
}

export type SettlementResult =
  | 'activated'
  | 'already_activated'
  /** The order already has a final outcome (rejected, aborted or amount_mismatch). */
  | 'already_settled'
  /** Flagged for reconciliation (HU26); the plan is not activated. */
  | 'amount_mismatch'
  | 'rejected'
  | 'aborted'
  /** Unknown order, or an order that belongs to another user. */
  | 'unknown_order';

/**
 * Records the provider's outcome for an order, confirmed by the backend after `commit`
 * (rule 6). Idempotent: backed by a unique `buy_order`, so a repeated confirmation never
 * activates or extends a plan twice. Checks the amount against the order and the plan price.
 */
export interface PaymentSettlement {
  settle(
    userId: UserId,
    buyOrder: string,
    outcome:
      | { readonly status: 'authorized'; readonly amount: Clp; readonly responseCode: string }
      | { readonly status: 'rejected' | 'aborted'; readonly responseCode: string },
  ): Promise<SettlementResult>;
}

/** Tabla 14 "Cancelada": stops the renewal; access lasts until the end of the paid period. */
export interface SubscriptionCanceller {
  cancelRenewal(userId: UserId): Promise<boolean>;
}

/** Capabilities of the plan in force for a user today (Tabla 13). `null` limits mean unlimited. */
export interface PlanCapabilities {
  readonly code: 'free' | 'paid' | 'family';
  readonly name: string;
  readonly maxSavedScenarios: number | null;
  readonly maxComparedScenarios: number;
  /** "Simulación de prepagos definidos por el usuario". */
  readonly userPrepayments: boolean;
  readonly householdSpace: boolean;
}

/** HU20: an expired paid plan falls back to the free plan without deleting data. */
export interface PlanReader {
  capabilitiesFor(actor: Actor): Promise<PlanCapabilities>;
}

/** Orders and the subscription of the actor (migrations 0005 and 0013). */
export interface SubscriptionStore {
  listPlans(): Promise<readonly PlanOffer[]>;
  currentPeriod(actor: Actor): Promise<SubscriptionPeriod | null>;
  latestOrder(actor: Actor): Promise<PaymentOrderSummary | null>;
  /** Today in Chile (YYYY-MM-DD), from the database clock used for plan validity. */
  todayInChile(): Promise<string>;
  /** Creates an order at the plan's current price; `null` when the plan is not for sale. */
  createOrder(context: WriteContext, buyOrder: string, planCode: Exclude<PlanCode, 'free'>): Promise<{ readonly amount: Clp } | null>;
  attachProviderToken(context: WriteContext, buyOrder: string, token: string): Promise<void>;
  /** Webpay return (no session): the order that holds this provider token. */
  findOrderByToken(token: string): Promise<{ readonly buyOrder: string; readonly userId: UserId; readonly status: string } | null>;
}
