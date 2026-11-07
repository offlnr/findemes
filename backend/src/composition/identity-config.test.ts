import { describe, expect, it } from 'vitest';
import { loadIdentityConfig } from './identity-config.ts';

const key = Buffer.alloc(32, 5).toString('base64url');
const valid = { DATABASE_URL: 'postgres://findemes_api:x@127.0.0.1:5432/findemes', JWT_SECRET: key, IDENTITY_HMAC_KEY: key };

describe('loadIdentityConfig', () => {
  it('is disabled without DATABASE_URL', () => {
    expect(loadIdentityConfig({})).toBeNull();
  });

  it('decodes the secrets and defaults the app URL', () => {
    const config = loadIdentityConfig(valid);
    expect(config?.jwtSecret).toHaveLength(32);
    expect(config?.appBaseUrl).toBe('http://localhost:8080');
  });

  it('names short or missing secrets without echoing their values', () => {
    expect(() => loadIdentityConfig({ ...valid, JWT_SECRET: 'c2hvcnQ' })).toThrow(/JWT_SECRET/);
    expect(() => loadIdentityConfig({ ...valid, IDENTITY_HMAC_KEY: undefined })).toThrow(/IDENTITY_HMAC_KEY/);
    expect(() => loadIdentityConfig({ ...valid, JWT_SECRET: 'c2hvcnQ' })).not.toThrow(/c2hvcnQ/);
  });
});
