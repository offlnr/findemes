import { describe, expect, it } from 'vitest';
import { loadBankConfig } from './bank-config.ts';

const key = Buffer.alloc(32, 1).toString('base64url');

describe('loadBankConfig', () => {
  it('offers only the demo bank without Fintoc keys', () => {
    expect(loadBankConfig({ BANK_TOKEN_KEY: key }).fintoc).toBeNull();
  });

  it('accepts Fintoc test keys and refuses live keys or a missing pair', () => {
    expect(loadBankConfig({ BANK_TOKEN_KEY: key, FINTOC_SECRET_KEY: 'sk_test_abcdefgh', FINTOC_PUBLIC_KEY: 'pk_test_abcdefgh' }).fintoc).toEqual({
      secretKey: 'sk_test_abcdefgh',
      publicKey: 'pk_test_abcdefgh',
    });
    expect(() => loadBankConfig({ BANK_TOKEN_KEY: key, FINTOC_SECRET_KEY: 'sk_live_abcdefgh', FINTOC_PUBLIC_KEY: 'pk_live_abcdefgh' })).toThrow('FINTOC_SECRET_KEY');
    expect(() => loadBankConfig({ BANK_TOKEN_KEY: key, FINTOC_SECRET_KEY: 'sk_test_abcdefgh' })).toThrow('FINTOC_PUBLIC_KEY');
  });

  it('requires a 32-byte token key, without echoing it', () => {
    expect(() => loadBankConfig({ BANK_TOKEN_KEY: 'c2hvcnQ' })).toThrow(/BANK_TOKEN_KEY$/);
  });
});
