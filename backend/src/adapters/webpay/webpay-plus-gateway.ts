import { clp } from '../../core/index.ts';
import type { PaymentStatusSource } from '../../modules/administration/ports/administration-ports.ts';
import type { PaymentCommitResult, PaymentGateway, PaymentStart } from '../../modules/subscription/ports/subscription-ports.ts';

/**
 * Transbank publishes these credentials for its integration environment (test cards, no real
 * charges). They are not secrets; production credentials come from the environment only.
 */
export const WEBPAY_INTEGRATION = Object.freeze({
  baseUrl: 'https://webpay3gint.transbank.cl',
  commerceCode: '597055555532',
  apiKey: '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
});
export const WEBPAY_PRODUCTION_URL = 'https://webpay3g.transbank.cl';

const API_PATH = '/rswebpaytransaction/api/webpay/v1.2/transactions';
const TIMEOUT_MS = 15_000;

export interface WebpayConfig {
  readonly baseUrl: string;
  readonly commerceCode: string;
  readonly apiKey: string;
  /** Injected in tests. */
  readonly fetch?: typeof fetch;
}

interface CommitResponse {
  readonly status?: string;
  readonly response_code?: number;
  readonly amount?: number;
  readonly buy_order?: string;
}

/** Error from Transbank, without the request body or credentials in the message. */
export class WebpayError extends Error {
  readonly httpStatus: number;
  constructor(operation: string, httpStatus: number) {
    super(`Webpay ${operation} failed with HTTP ${String(httpStatus)}`);
    this.name = 'WebpayError';
    this.httpStatus = httpStatus;
  }
}

/**
 * HU26: status of a transaction as Transbank reports it (GET transactions/{token}). Used by the
 * admin API to reconcile orders; it never changes anything.
 */
export function createWebpayStatusSource(config: WebpayConfig): PaymentStatusSource {
  const doFetch = config.fetch ?? fetch;
  return {
    async status(token) {
      const response = await doFetch(`${config.baseUrl}${API_PATH}/${encodeURIComponent(token)}`, {
        method: 'GET',
        headers: { 'Tbk-Api-Key-Id': config.commerceCode, 'Tbk-Api-Key-Secret': config.apiKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404 || response.status === 422) return null;
      if (!response.ok) throw new WebpayError('status', response.status);
      const body = (await response.json()) as { status?: unknown; amount?: unknown; buy_order?: unknown };
      return {
        status: typeof body.status === 'string' ? body.status : 'UNKNOWN',
        amount: typeof body.amount === 'number' ? body.amount : null,
        buyOrder: typeof body.buy_order === 'string' ? body.buy_order : null,
      };
    },
  };
}

/**
 * Webpay Plus REST adapter (rule 7). The card is typed only on Transbank's form; this adapter
 * sees tokens, orders and amounts, never card data (rule 6).
 */
export function createWebpayPlusGateway(config: WebpayConfig): PaymentGateway {
  const doFetch = config.fetch ?? fetch;
  const headers = {
    'Tbk-Api-Key-Id': config.commerceCode,
    'Tbk-Api-Key-Secret': config.apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  async function call(operation: string, method: 'POST' | 'PUT' | 'GET', path: string, body?: object): Promise<{ status: number; json: unknown }> {
    const response = await doFetch(`${config.baseUrl}${API_PATH}${path}`, {
      method,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json: unknown = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 422) throw new WebpayError(operation, response.status);
    return { status: response.status, json };
  }

  return {
    async start(buyOrder, sessionId, amount, returnUrl): Promise<PaymentStart> {
      const { status, json } = await call('create', 'POST', '', { buy_order: buyOrder, session_id: sessionId, amount, return_url: returnUrl });
      const created = json as { token?: unknown; url?: unknown };
      if (status !== 200 || typeof created.token !== 'string' || typeof created.url !== 'string') throw new WebpayError('create', status);
      return { token: created.token, redirectUrl: created.url };
    },

    async commit(token): Promise<PaymentCommitResult> {
      const path = `/${encodeURIComponent(token)}`;
      const { status, json } = await call('commit', 'PUT', path);
      if (status === 422) {
        // Already committed (repeated return or retry): the stored outcome is the source of truth.
        return { status: 'already_committed', buyOrder: '' };
      }
      const result = json as CommitResponse;
      if (typeof result.buy_order !== 'string') throw new WebpayError('commit', status);
      const responseCode = String(result.response_code ?? 'unknown');
      if (result.status === 'AUTHORIZED' && result.response_code === 0 && Number.isSafeInteger(result.amount)) {
        return { status: 'authorized', buyOrder: result.buy_order, amount: clp(result.amount ?? 0), responseCode };
      }
      return { status: 'rejected', buyOrder: result.buy_order, responseCode };
    },
  };
}
