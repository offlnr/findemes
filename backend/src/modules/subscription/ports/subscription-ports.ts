import type { Clp } from '../../../core/index.ts';
import type { UserId } from '../../shared/actor.ts';

export interface PaymentStart {
  readonly token: string;
  readonly redirectUrl: string;
}

export type PaymentCommitResult =
  | { readonly status: 'authorized'; readonly buyOrder: string; readonly amount: Clp }
  | { readonly status: 'rejected'; readonly buyOrder: string }
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
