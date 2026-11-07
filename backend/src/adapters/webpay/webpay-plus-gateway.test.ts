import { describe, expect, it } from 'vitest';
import { clp } from '../../core/index.ts';
import { createWebpayPlusGateway, WEBPAY_INTEGRATION, WebpayError } from './webpay-plus-gateway.ts';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body: object) {
  const calls: Call[] = [];
  const impl = (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  };
  return { calls, fetch: impl };
}

const gateway = (status: number, body: object) => {
  const fake = fakeFetch(status, body);
  return { fake, webpay: createWebpayPlusGateway({ ...WEBPAY_INTEGRATION, fetch: fake.fetch }) };
};

describe('Webpay Plus gateway', () => {
  it('creates a transaction with the commerce credentials and returns the form URL', async () => {
    const { fake, webpay } = gateway(200, { token: 'tok', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' });
    const started = await webpay.start('FDM1', 'session', clp(5990), 'http://localhost:3000/v1/payments/webpay/return');
    expect(started).toEqual({ token: 'tok', redirectUrl: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' });
    const call = fake.calls[0];
    expect(call?.url).toBe('https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions');
    expect(call?.init.method).toBe('POST');
    expect((call?.init.headers as Record<string, string>)['Tbk-Api-Key-Id']).toBe('597055555532');
    expect(JSON.parse(typeof call?.init.body === 'string' ? call.init.body : '{}')).toEqual({ buy_order: 'FDM1', session_id: 'session', amount: 5990, return_url: 'http://localhost:3000/v1/payments/webpay/return' });
  });

  it('commits: authorized only with AUTHORIZED and response code 0', async () => {
    expect(await gateway(200, { status: 'AUTHORIZED', response_code: 0, amount: 5990, buy_order: 'FDM1' }).webpay.commit('tok')).toEqual({
      status: 'authorized',
      buyOrder: 'FDM1',
      amount: 5990,
      responseCode: '0',
    });
    expect(await gateway(200, { status: 'FAILED', response_code: -1, amount: 5990, buy_order: 'FDM1' }).webpay.commit('tok')).toEqual({
      status: 'rejected',
      buyOrder: 'FDM1',
      responseCode: '-1',
    });
  });

  it('reports a repeated commit and fails loudly on other errors', async () => {
    expect((await gateway(422, { error_message: 'Invalid status' }).webpay.commit('tok')).status).toBe('already_committed');
    await expect(gateway(500, {}).webpay.commit('tok')).rejects.toBeInstanceOf(WebpayError);
    await expect(gateway(401, {}).webpay.start('FDM1', 's', clp(1), 'http://x')).rejects.toThrow('HTTP 401');
  });
});
