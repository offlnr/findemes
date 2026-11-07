import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { UserId } from '../../modules/shared/actor.ts';
import { loadBreachedPasswordList } from '../breached-passwords/breached-password-list.ts';
import { argon2PasswordHasher } from './argon2-password-hasher.ts';
import { createAccessTokenService } from './jose-access-tokens.ts';
import { createSecretTools } from './node-secret-tools.ts';

const USER = '3f2b8c1e-7d4a-4f6b-9c2d-1a2b3c4d5e6f' as UserId;
const secret = new Uint8Array(32).fill(7);
const clockAt = (iso: string) => ({ now: () => new Date(iso) });
const tokens = (iso = '2026-11-15T12:00:00Z') =>
  createAccessTokenService({ secret, issuer: 'findemes-api', audience: 'findemes-app', lifetimeMs: 15 * 60_000, clock: clockAt(iso) });

describe('argon2PasswordHasher', () => {
  it('produces argon2id hashes with the OWASP parameters and verifies them', async () => {
    const hash = await argon2PasswordHasher.hash('correcto caballo batería');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await argon2PasswordHasher.verify(hash, 'correcto caballo batería')).toBe(true);
    expect(await argon2PasswordHasher.verify(hash, 'otra')).toBe(false);
    expect(await argon2PasswordHasher.verify('no-es-un-hash', 'x')).toBe(false);
  });
});

describe('access tokens', () => {
  it('round-trips the user id and expires after 15 minutes', async () => {
    const { token, expiresAt } = await tokens().issue(USER);
    expect(expiresAt.toISOString()).toBe('2026-11-15T12:15:00.000Z');
    expect(await tokens('2026-11-15T12:14:00Z').verify(token)).toBe(USER);
    expect(await tokens('2026-11-15T12:16:00Z').verify(token)).toBeNull();
  });

  it('rejects other audiences, issuers, algorithms and unsigned tokens', async () => {
    const now = Math.floor(Date.parse('2026-11-15T12:00:00Z') / 1000);
    const forge = (alg: string, aud: string, iss: string) =>
      new SignJWT({}).setProtectedHeader({ alg }).setSubject(USER).setAudience(aud).setIssuer(iss).setExpirationTime(now + 600).sign(secret);

    expect(await tokens().verify(await forge('HS256', 'otra-app', 'findemes-api'))).toBeNull();
    expect(await tokens().verify(await forge('HS256', 'findemes-app', 'otro'))).toBeNull();
    expect(await tokens().verify(await forge('HS512', 'findemes-app', 'findemes-api'))).toBeNull();
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: USER, aud: 'findemes-app', iss: 'findemes-api', exp: now + 600 })).toString('base64url')}.`;
    expect(await tokens().verify(unsigned)).toBeNull();
  });

  it('refuses short secrets', () => {
    expect(() => createAccessTokenService({ secret: new Uint8Array(16), issuer: 'i', audience: 'a', lifetimeMs: 1, clock: clockAt('2026-01-01T00:00:00Z') })).toThrow();
  });
});

describe('secret tools', () => {
  const tools = createSecretTools(new Uint8Array(32).fill(1));

  it('creates 32-byte opaque tokens and 6-digit codes', () => {
    expect(Buffer.from(tools.opaqueToken(), 'base64url')).toHaveLength(32);
    expect(tools.opaqueToken()).not.toBe(tools.opaqueToken());
    for (let i = 0; i < 50; i++) expect(tools.sixDigitCode()).toMatch(/^\d{6}$/);
  });

  it('digests to 32 bytes, and the HMAC depends on the key', () => {
    expect(tools.sha256('x')).toHaveLength(32);
    expect(Buffer.from(tools.hmac('123456'))).not.toEqual(Buffer.from(createSecretTools(new Uint8Array(32).fill(2)).hmac('123456')));
  });
});

describe('breached password list', () => {
  it('matches entries without case sensitivity and ignores comments', () => {
    const list = loadBreachedPasswordList();
    expect(list.contains('Contraseña123')).toBe(true);
    expect(list.contains('correcto caballo batería')).toBe(false);
    expect(list.contains('# contraseñas de 10 o más caracteres')).toBe(false);
  });
});
