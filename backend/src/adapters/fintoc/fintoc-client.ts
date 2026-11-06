import { clp, parseYearMonth } from '../../core/index.ts';
import type {
  AggregatedAccount,
  AggregatedMovement,
  BankAggregator,
  BankLinkProvider,
  DataOrigin,
  ProviderLink,
} from '../../modules/aggregation/ports/aggregation-ports.ts';

export const FINTOC_API = 'https://api.fintoc.com/v1';
const TIMEOUT_MS = 20_000;
const PER_PAGE = 300;
/** Safety cap on pagination: 30 pages of 300 movements per account and sync. */
const MAX_PAGES = 30;

export interface FintocConfig {
  /** `sk_test_...` in test mode (ADR-002); `sk_live_...` would require a commercial agreement. */
  readonly secretKey: string;
  /** `pk_test_...`, sent to the app to open the widget. Not a secret. */
  readonly publicKey: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

/** Error from Fintoc without the URL (it carries the link token) or the key. */
export class FintocError extends Error {
  readonly httpStatus: number;
  constructor(operation: string, httpStatus: number) {
    super(`Fintoc ${operation} failed with HTTP ${String(httpStatus)}`);
    this.name = 'FintocError';
    this.httpStatus = httpStatus;
  }
}

interface FintocAccount {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance?: { available?: number };
}

interface FintocMovement {
  id: string;
  amount: number;
  currency: string;
  description: string | null;
  post_date: string;
}

const nextPage = (header: string | null): string | null => {
  const match = header === null ? null : /<([^>]+)>;\s*rel="next"/.exec(header);
  return match?.[1] ?? null;
};

/**
 * Fintoc adapter (ADR-002, rule 7): Link Intents, exchange, accounts and movements in CLP. The
 * bank password is entered in Fintoc's widget and never reaches this code.
 */
export function createFintocClient(config: FintocConfig): BankLinkProvider & BankAggregator {
  const doFetch = config.fetch ?? fetch;
  const base = config.baseUrl ?? FINTOC_API;
  const origin: DataOrigin = config.secretKey.startsWith('sk_live_') ? 'real' : 'provider_test';

  async function call(operation: string, method: 'GET' | 'POST' | 'DELETE', url: string, body?: object): Promise<Response> {
    const response = await doFetch(url, {
      method,
      headers: { Authorization: config.secretKey, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new FintocError(operation, response.status);
    return response;
  }

  return {
    async createLinkIntent() {
      const response = await call('link intent', 'POST', `${base}/link_intents`, { product: 'movements', country: 'cl', holder_type: 'individual' });
      const intent = (await response.json()) as { widget_token?: unknown };
      if (typeof intent.widget_token !== 'string') throw new FintocError('link intent', response.status);
      return { widgetToken: intent.widget_token, publicKey: config.publicKey };
    },

    async exchange(exchangeToken): Promise<ProviderLink> {
      const url = `${base}/links/exchange?${new URLSearchParams({ exchange_token: exchangeToken }).toString()}`;
      const response = await call('exchange', 'GET', url);
      const link = (await response.json()) as { id?: unknown; link_token?: unknown; institution?: { name?: unknown }; mode?: unknown };
      if (typeof link.id !== 'string' || typeof link.link_token !== 'string') throw new FintocError('exchange', response.status);
      return {
        providerLinkId: link.id,
        linkToken: link.link_token,
        institutionName: typeof link.institution?.name === 'string' ? link.institution.name.slice(0, 120) : 'Banco',
        origin: link.mode === 'live' ? 'real' : 'provider_test',
      };
    },

    async revoke(linkToken) {
      await call('revoke', 'DELETE', `${base}/links/${encodeURIComponent(linkToken)}`);
    },

    async listAccounts(linkToken) {
      const response = await call('accounts', 'GET', `${base}/accounts?${new URLSearchParams({ link_token: linkToken }).toString()}`);
      const accounts = (await response.json()) as FintocAccount[];
      // The core works in CLP only (rule 10); other currencies are not aggregated.
      return accounts
        .filter((account) => account.currency === 'CLP')
        .map(
          (account): AggregatedAccount => ({
            externalId: account.id,
            name: account.name.slice(0, 120),
            type: account.type.slice(0, 40),
            availableBalance: clp(Math.trunc(account.balance?.available ?? 0)),
            origin,
          }),
        );
    },

    async listMovements(linkToken, accountExternalId, window) {
      const params = new URLSearchParams({ link_token: linkToken, per_page: String(PER_PAGE) });
      if ('since' in window) params.set('since', `${String(window.since.year)}-${String(window.since.month).padStart(2, '0')}-01`);
      else params.set('updated_since', window.updatedSince.toISOString());
      let url: string | null = `${base}/accounts/${encodeURIComponent(accountExternalId)}/movements?${params.toString()}`;
      const movements: AggregatedMovement[] = [];
      for (let page = 0; url !== null && page < MAX_PAGES; page += 1) {
        const response: Response = await call('movements', 'GET', url);
        const rows = (await response.json()) as FintocMovement[];
        for (const row of rows) {
          if (row.currency !== 'CLP' || !Number.isSafeInteger(row.amount) || row.amount === 0) continue;
          const postedOn = row.post_date.slice(0, 10);
          movements.push({
            externalId: row.id,
            accountExternalId,
            postedOn,
            month: parseYearMonth(postedOn.slice(0, 7)),
            amount: clp(row.amount),
            description: (row.description ?? '').slice(0, 500),
            origin,
          });
        }
        url = nextPage(response.headers.get('link'));
      }
      return movements;
    },
  };
}
