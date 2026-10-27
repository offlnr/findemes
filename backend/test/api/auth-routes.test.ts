import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryIdentity } from '../support/in-memory-identity.ts';
import { createAccessTokenService } from '../../src/adapters/crypto/jose-access-tokens.ts';
import { IdentityService } from '../../src/modules/identity/application/identity-service.ts';
import { buildPublicApi } from '../../src/api/build-public-api.ts';

const EMAIL = 'ana@example.cl';
const PASSWORD = 'correcto caballo batería';

let env: ReturnType<typeof createInMemoryIdentity>;
let app: FastifyInstance;

beforeEach(async () => {
  env = createInMemoryIdentity();
  const accessTokens = createAccessTokenService({
    secret: new Uint8Array(32).fill(9),
    issuer: 'findemes-api',
    audience: 'findemes-app',
    lifetimeMs: 15 * 60_000,
    clock: env.clock,
  });
  const identity = new IdentityService({ ...env.deps, accessTokens });
  app = await buildPublicApi({
    logger: false,
    clock: env.clock,
    auth: { identity, accessTokens, accounts: env.deps.accounts, secureCookies: true },
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const post = (url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, headers, ...(payload === undefined ? {} : { payload }) });

function cookie(response: LightMyRequestResponse, name: string) {
  return response.cookies.find((c) => c.name === name);
}

async function registerAndVerify() {
  expect((await post('/v1/auth/register', { email: EMAIL, password: PASSWORD, displayName: 'Ana' })).statusCode).toBe(202);
  expect((await post('/v1/auth/verify-email', { token: env.tokenFromLastEmail(EMAIL) })).statusCode).toBe(204);
}

describe('web sign-in flow', () => {
  it('signs in with an emailed code and keeps the refresh token in a strict HttpOnly cookie', async () => {
    await registerAndVerify();

    const login = await post('/v1/auth/login', { email: EMAIL, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const { status, challengeId } = login.json<{ status: string; challengeId: string }>();
    expect(status).toBe('code_required');
    const device = cookie(login, 'fdm_device');
    expect(device).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/v1/auth' });

    const confirmed = await post('/v1/auth/login/code', { challengeId, code: env.codeFromLastEmail(EMAIL) });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.headers['cache-control']).toBe('no-store');
    const session = confirmed.json<Record<string, string>>();
    expect(Object.keys(session).sort()).toEqual(['accessToken', 'accessTokenExpiresAt']);
    const refresh = cookie(confirmed, 'fdm_refresh');
    expect(refresh).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/v1/auth' });

    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${session['accessToken'] ?? ''}` } });
    expect(me.json()).toMatchObject({ email: EMAIL, displayName: 'Ana' });

    const renewed = await post('/v1/auth/refresh', undefined, { cookie: `fdm_refresh=${refresh?.value ?? ''}` });
    expect(renewed.statusCode).toBe(200);
    expect(cookie(renewed, 'fdm_refresh')?.value).not.toBe(refresh?.value);

    // The device cookie skips the code next time.
    const again = await post('/v1/auth/login', { email: EMAIL, password: PASSWORD }, { cookie: `fdm_device=${device?.value ?? ''}` });
    expect(again.json<{ status: string }>().status).toBe('authenticated');
  });
});

describe('mobile sign-in flow', () => {
  it('returns the refresh token and device id in the body and rotates them', async () => {
    await registerAndVerify();
    const login = await post('/v1/auth/login', { email: EMAIL, password: PASSWORD, client: 'mobile' });
    const { challengeId, deviceId } = login.json<{ challengeId: string; deviceId: string }>();
    expect(deviceId).toBeTruthy();
    expect(login.cookies).toHaveLength(0);

    const confirmed = await post('/v1/auth/login/code', { challengeId, code: env.codeFromLastEmail(EMAIL), client: 'mobile' });
    const { refreshToken, accessToken } = confirmed.json<{ refreshToken: string; accessToken: string }>();
    expect(refreshToken).toBeTruthy();

    const renewed = await post('/v1/auth/refresh', { refreshToken });
    expect(renewed.json<{ refreshToken: string }>().refreshToken).not.toBe(refreshToken);
    // Reusing the consumed token is rejected (and revokes the family).
    expect((await post('/v1/auth/refresh', { refreshToken })).statusCode).toBe(401);

    expect((await post('/v1/auth/logout-all', undefined, { authorization: `Bearer ${accessToken}` })).statusCode).toBe(204);
  });
});

describe('errors that reveal nothing', () => {
  it('answers the same 401 for an unknown email and a wrong password', async () => {
    await registerAndVerify();
    const unknown = await post('/v1/auth/login', { email: 'nadie@example.cl', password: PASSWORD });
    const wrong = await post('/v1/auth/login', { email: EMAIL, password: 'no es la clave' });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.body).toBe(wrong.body);
  });

  it('answers the same 202 to registration and reset whether or not the email exists', async () => {
    await registerAndVerify();
    const taken = await post('/v1/auth/register', { email: EMAIL, password: 'otra clave muy larga', displayName: 'Otra' });
    const fresh = await post('/v1/auth/register', { email: 'nuevo@example.cl', password: 'otra clave muy larga', displayName: 'Otra' });
    expect(taken.statusCode).toBe(202);
    expect(taken.body).toBe(fresh.body);

    const known = await post('/v1/auth/password-reset', { email: EMAIL });
    const unknown = await post('/v1/auth/password-reset', { email: 'nadie@example.cl' });
    expect(known.body).toBe(unknown.body);
  });

  it('locks after five failures with Retry-After', async () => {
    await registerAndVerify();
    for (let i = 0; i < 5; i++) await post('/v1/auth/login', { email: EMAIL, password: 'no es la clave' });
    const locked = await post('/v1/auth/login', { email: EMAIL, password: PASSWORD });
    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBe('60');
  });

  it('answers schema errors with 400, never 500, without echoing values', async () => {
    const response = await post('/v1/auth/register', { email: EMAIL, password: PASSWORD, displayName: 'Ana', role: 'admin' });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe('validation_error');
    expect(response.body).not.toContain(PASSWORD);
  });

  it('reports invalid registration fields without echoing the values', async () => {
    const response = await post('/v1/auth/register', { email: 'ana', password: 'corta123', displayName: 'Ana' });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ issues: { field: string }[] }>().issues.map((i) => i.field)).toEqual(['email', 'password']);
    expect(response.body).not.toContain('corta123');
  });
});

describe('protected routes deny by default', () => {
  it('rejects missing, malformed and forged tokens', async () => {
    const forged = createAccessTokenService({
      secret: new Uint8Array(32).fill(1),
      issuer: 'findemes-api',
      audience: 'findemes-app',
      lifetimeMs: 60_000,
      clock: env.clock,
    });
    const { token } = await forged.issue('3f2b8c1e-7d4a-4f6b-9c2d-1a2b3c4d5e6f' as never);
    for (const authorization of [undefined, 'Bearer nope', `Bearer ${token}`]) {
      const response = await app.inject({ method: 'GET', url: '/v1/me', headers: authorization === undefined ? {} : { authorization } });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized', message: 'Se requiere autenticación.' });
    }
  });

  it('rejects an expired access token', async () => {
    await registerAndVerify();
    const login = await post('/v1/auth/login', { email: EMAIL, password: PASSWORD, client: 'mobile' });
    const { challengeId } = login.json<{ challengeId: string }>();
    const { accessToken } = (await post('/v1/auth/login/code', { challengeId, code: env.codeFromLastEmail(EMAIL), client: 'mobile' })).json<{ accessToken: string }>();
    env.clock.advance(16 * 60_000);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${accessToken}` } })).statusCode).toBe(401);
  });
});
