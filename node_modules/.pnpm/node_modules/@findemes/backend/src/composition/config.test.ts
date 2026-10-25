import { describe, expect, it } from 'vitest';
import { loadServiceConfig } from './config.ts';

describe('loadServiceConfig', () => {
  it('uses safe defaults when variables are missing', () => {
    expect(loadServiceConfig({}, 3000)).toEqual({
      environment: 'development',
      host: '127.0.0.1',
      port: 3000,
      logLevel: 'info',
    });
  });

  it('reads the variables when present', () => {
    const config = loadServiceConfig(
      { NODE_ENV: 'production', HOST: '0.0.0.0', PORT: '8080', LOG_LEVEL: 'warn' },
      3000,
    );
    expect(config).toEqual({
      environment: 'production',
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'warn',
    });
  });

  it('treats empty variables as missing', () => {
    expect(loadServiceConfig({ PORT: '', HOST: '' }, 3001).port).toBe(3001);
  });

  it('fails fast on invalid values without echoing them', () => {
    expect(() => loadServiceConfig({ PORT: 'secret-value' }, 3000)).toThrow(/PORT/);
    expect(() => loadServiceConfig({ PORT: 'secret-value' }, 3000)).not.toThrow(/secret-value/);
    expect(() => loadServiceConfig({ PORT: '70000' }, 3000)).toThrow(/PORT/);
    expect(() => loadServiceConfig({ NODE_ENV: 'staging' }, 3000)).toThrow(/NODE_ENV/);
  });
});
