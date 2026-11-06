import { describe, expect, it } from 'vitest';
import { WEBPAY_INTEGRATION } from '../adapters/webpay/webpay-plus-gateway.ts';
import { loadPaymentsConfig } from './payments-config.ts';

describe('loadPaymentsConfig', () => {
  it('uses the Transbank integration environment by default', () => {
    const config = loadPaymentsConfig({});
    expect(config.environment).toBe('integration');
    expect(config.webpay).toEqual({ ...WEBPAY_INTEGRATION });
    expect(config.apiPublicUrl).toBe('http://localhost:3000');
  });

  it('refuses production without its own credentials, naming only the variables', () => {
    expect(() => loadPaymentsConfig({ WEBPAY_ENVIRONMENT: 'production' })).toThrow('WEBPAY_COMMERCE_CODE, WEBPAY_API_KEY');
    expect(() => loadPaymentsConfig({ API_PUBLIC_URL: 'https://api.example.cl/path' })).toThrow('API_PUBLIC_URL');
    const production = loadPaymentsConfig({ WEBPAY_ENVIRONMENT: 'production', WEBPAY_COMMERCE_CODE: '597000000001', WEBPAY_API_KEY: 'k'.repeat(40) });
    expect(production.webpay.baseUrl).toBe('https://webpay3g.transbank.cl');
  });
});
