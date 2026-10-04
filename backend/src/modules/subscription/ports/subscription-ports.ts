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

/**
 * Plan activation, confirmed by the backend after `commit` (rule 6). Idempotent: backed by a
 * unique `buy_order`, so a repeated confirmation never activates or extends a plan twice.
 * The adapter checks that `amount` matches the price of the plan bought with that order.
 */
export interface SubscriptionActivator {
  activateOnce(
    userId: UserId,
    buyOrder: string,
    amount: Clp,
  ): Promise<'activated' | 'already_activated' | 'amount_mismatch' | 'unknown_order'>;
}
