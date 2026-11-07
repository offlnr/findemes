import { describe, expect, it } from 'vitest';
import { yearMonth } from '../../core/index.ts';
import { createFintocClient, FintocError } from './fintoc-client.ts';

type Route = (url: URL, init: RequestInit) => { status?: number; body: unknown; link?: string };

function fakeFintoc(route: Route) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push({ url, init: init ?? {} });
    const answer = route(url, init ?? {});
    const headers = new Headers({ 'content-type': 'application/json' });
    if (answer.link !== undefined) headers.set('link', answer.link);
    return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers }));
  };
  return { calls, client: createFintocClient({ secretKey: 'sk_test_x', publicKey: 'pk_test_y', fetch: impl }) };
}

describe('Fintoc client', () => {
  it('creates a movements link intent for individuals in Chile with the secret key', async () => {
    const { calls, client } = fakeFintoc(() => ({ body: { widget_token: 'wt' } }));
    expect(await client.createLinkIntent()).toEqual({ widgetToken: 'wt', publicKey: 'pk_test_y' });
    expect(calls[0]?.url.pathname).toBe('/v1/link_intents');
    expect((calls[0]?.init.headers as Record<string, string>)['Authorization']).toBe('sk_test_x');
    expect(JSON.parse(typeof calls[0]?.init.body === 'string' ? calls[0].init.body : '{}')).toEqual({ product: 'movements', country: 'cl', holder_type: 'individual' });
  });

  it('exchanges the widget token for a link labelled as test data', async () => {
    const { client } = fakeFintoc(() => ({ body: { id: 'link_1', link_token: 'link_1_token_abc', institution: { name: 'BancoEstado' }, mode: 'test' } }));
    expect(await client.exchange('ex')).toEqual({ providerLinkId: 'link_1', linkToken: 'link_1_token_abc', institutionName: 'BancoEstado', origin: 'provider_test' });
  });

  it('reads CLP accounts and paginated movements, skipping other currencies', async () => {
    const { calls, client } = fakeFintoc((url) => {
      if (url.pathname === '/v1/accounts') {
        return { body: [{ id: 'acc_1', name: 'Cuenta Corriente', type: 'checking_account', currency: 'CLP', balance: { available: 812_000 } }, { id: 'acc_2', name: 'USD', type: 'checking_account', currency: 'USD' }] };
      }
      if (url.searchParams.get('page') === '2') return { body: [{ id: 'm2', amount: 1_500_000, currency: 'CLP', description: 'Sueldo', post_date: '2026-10-30T00:00:00Z' }] };
      return {
        body: [{ id: 'm1', amount: -45_990, currency: 'CLP', description: 'Supermercado', post_date: '2026-11-02T00:00:00Z' }],
        link: `<https://api.fintoc.com/v1/accounts/acc_1/movements?page=2>; rel="next"`,
      };
    });
    const accounts = await client.listAccounts('tok');
    expect(accounts).toEqual([{ externalId: 'acc_1', name: 'Cuenta Corriente', type: 'checking_account', availableBalance: 812_000, origin: 'provider_test' }]);
    const movements = await client.listMovements('tok', 'acc_1', { since: yearMonth(2026, 10) });
    expect(movements.map((m) => [m.externalId, m.amount, m.postedOn])).toEqual([
      ['m1', -45_990, '2026-11-02'],
      ['m2', 1_500_000, '2026-10-30'],
    ]);
    expect(calls[1]?.url.searchParams.get('since')).toBe('2026-10-01');
  });

  it('fails with the HTTP status only, never the URL that carries the link token', async () => {
    const { client } = fakeFintoc(() => ({ status: 401, body: { error: 'x' } }));
    const error = await client.listAccounts('secret_link_token').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FintocError);
    expect(String(error)).not.toContain('secret_link_token');
  });
});
