import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryIdentity } from '../../../../test/support/in-memory-identity.ts';
import { IdentityService, type LoginResult, type Session } from './identity-service.ts';

const EMAIL = 'ana@example.cl';
const PASSWORD = 'correcto caballo batería';
const IP = '203.0.113.9';

let env: ReturnType<typeof createInMemoryIdentity>;
let service: IdentityService;

beforeEach(() => {
  env = createInMemoryIdentity();
  service = new IdentityService(env.deps);
});

function firstActor() {
  const [userId] = env.users.keys();
  if (userId === undefined) throw new Error('no user');
  return { userId };
}

async function registerAndVerify(email = EMAIL) {
  await service.register({ email, password: PASSWORD, displayName: 'Ana' });
  await service.verifyEmail(env.tokenFromLastEmail(email));
}

/** Logs in from a new device and confirms the emailed code. */
async function fullLogin(): Promise<{ session: Session; deviceId: string }> {
  const first = await service.login({ email: EMAIL, password: PASSWORD, deviceId: null, ip: IP });
  if (first.status !== 'code_required') throw new Error(first.status);
  const session = await service.confirmLoginCode({ challengeId: first.challengeId, code: env.codeFromLastEmail(EMAIL) });
  if (session === null) throw new Error('code rejected');
  return { session, deviceId: first.deviceId };
}

describe('register (HU17, CU-08)', () => {
  it('creates the account with a hashed password and sends a verification link', async () => {
    expect(await service.register({ email: ' Ana@Example.CL ', password: PASSWORD, displayName: ' Ana ' })).toEqual({ ok: true });

    const [user] = [...env.users.values()];
    expect(user).toMatchObject({ email: EMAIL, displayName: 'Ana', emailVerifiedAt: null });
    expect(user?.passwordHash).not.toBe(PASSWORD);
    expect(env.lastEmail(EMAIL).subject).toBe('Confirma tu correo en Fin de Mes');
    expect(env.tokenFromLastEmail(EMAIL)).not.toBe('');
  });

  it('reports every invalid field without echoing values', async () => {
    const result = await service.register({ email: 'ana', password: 'corta', displayName: 'A' });
    expect(result).toEqual({
      ok: false,
      issues: [
        { field: 'email', message: 'Ingresa un correo válido.' },
        { field: 'displayName', message: 'El nombre debe tener entre 2 y 40 caracteres.' },
        { field: 'password', message: 'La contraseña debe tener al menos 10 caracteres.' },
      ],
    });
  });

  it('rejects breached passwords', async () => {
    const result = await service.register({ email: EMAIL, password: 'contraseña123', displayName: 'Ana' });
    expect(result.ok).toBe(false);
  });

  it('answers the same for a taken email and notifies the owner instead', async () => {
    await registerAndVerify();
    expect(await service.register({ email: EMAIL, password: 'otra contraseña larga', displayName: 'Otra' })).toEqual({ ok: true });
    expect(env.users.size).toBe(1);
    expect(env.lastEmail(EMAIL).subject).toBe('Intento de registro en Fin de Mes');
  });

  it('accepts a verification link only once', async () => {
    await service.register({ email: EMAIL, password: PASSWORD, displayName: 'Ana' });
    const token = env.tokenFromLastEmail(EMAIL);
    expect(await service.verifyEmail(token)).toBe(true);
    expect(await service.verifyEmail(token)).toBe(false);
  });
});

describe('login (HU17.1, CU-11)', () => {
  it('requires a verified email', async () => {
    await service.register({ email: EMAIL, password: PASSWORD, displayName: 'Ana' });
    expect((await service.login({ email: EMAIL, password: PASSWORD, deviceId: null, ip: IP })).status).toBe('email_not_verified');
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    await registerAndVerify();
    const unknown = await service.login({ email: 'nadie@example.cl', password: PASSWORD, deviceId: null, ip: IP });
    const wrong = await service.login({ email: EMAIL, password: 'no es la clave', deviceId: null, ip: IP });
    expect(unknown).toEqual({ status: 'invalid_credentials' });
    expect(wrong).toEqual({ status: 'invalid_credentials' });
  });

  it('asks a new device for an emailed code, then trusts it for 30 days', async () => {
    await registerAndVerify();
    const { session, deviceId } = await fullLogin();
    expect(session.accessToken).toMatch(/^access:/);

    const again = await service.login({ email: EMAIL, password: PASSWORD, deviceId, ip: IP });
    expect(again.status).toBe('authenticated');

    env.clock.advance(31 * 24 * 3600_000);
    expect((await service.login({ email: EMAIL, password: PASSWORD, deviceId, ip: IP })).status).toBe('code_required');
  });

  it('rejects a wrong or malformed code and stops after five attempts', async () => {
    await registerAndVerify();
    const first = (await service.login({ email: EMAIL, password: PASSWORD, deviceId: null, ip: IP })) as Extract<LoginResult, { status: 'code_required' }>;
    const right = env.codeFromLastEmail(EMAIL);
    expect(await service.confirmLoginCode({ challengeId: first.challengeId, code: 'abc' })).toBeNull();
    for (let i = 0; i < 5; i++) {
      expect(await service.confirmLoginCode({ challengeId: first.challengeId, code: '000000' })).toBeNull();
    }
    expect(await service.confirmLoginCode({ challengeId: first.challengeId, code: right })).toBeNull();
  });

  it('locks the account temporarily after five consecutive failures, never for good', async () => {
    await registerAndVerify();
    for (let i = 0; i < 5; i++) {
      await service.login({ email: EMAIL, password: 'no es la clave', deviceId: null, ip: IP });
    }
    expect(await service.login({ email: EMAIL, password: PASSWORD, deviceId: null, ip: IP })).toEqual({ status: 'locked', retryAfterMs: 60_000 });

    env.clock.advance(60_000);
    expect((await service.login({ email: EMAIL, password: PASSWORD, deviceId: null, ip: IP })).status).toBe('code_required');
  });

  it('refuses suspended accounts after checking the password', async () => {
    await registerAndVerify();
    const [user] = [...env.users.values()];
    if (user) user.status = 'suspended';
    expect((await service.login({ email: EMAIL, password: PASSWORD, deviceId: null, ip: IP })).status).toBe('suspended');
  });
});

describe('sessions (HU17.3)', () => {
  it('rotates the refresh token and detects reuse of an old one', async () => {
    await registerAndVerify();
    const { session } = await fullLogin();

    const next = await service.refresh(session.refreshToken);
    expect(next?.refreshToken).not.toBe(session.refreshToken);

    // Replaying the consumed token revokes the family, including the newest token.
    expect(await service.refresh(session.refreshToken)).toBeNull();
    expect(await service.refresh(next?.refreshToken ?? '')).toBeNull();
  });

  it('logout closes only that session; logout everywhere closes all and forgets devices', async () => {
    await registerAndVerify();
    const a = await fullLogin();
    const b = await service.login({ email: EMAIL, password: PASSWORD, deviceId: a.deviceId, ip: IP });
    if (b.status !== 'authenticated') throw new Error(b.status);
    const actor = firstActor();

    await service.logout(actor, a.session.refreshToken);
    expect(await service.refresh(a.session.refreshToken)).toBeNull();
    const stillOpen = await service.refresh(b.session.refreshToken);
    expect(stillOpen).not.toBeNull();

    await service.logoutEverywhere(actor);
    expect(await service.refresh(stillOpen?.refreshToken ?? '')).toBeNull();
    expect((await service.login({ email: EMAIL, password: PASSWORD, deviceId: a.deviceId, ip: IP })).status).toBe('code_required');
  });
});

describe('password reset (HU17.2) and change (HU17.4)', () => {
  it('answers silently for unknown emails', async () => {
    await service.requestPasswordReset('nadie@example.cl');
    expect(env.outbox).toHaveLength(0);
  });

  it('resets with a single-use link that expires in 30 minutes and closes every session', async () => {
    await registerAndVerify();
    const { session } = await fullLogin();

    await service.requestPasswordReset(EMAIL);
    const token = env.tokenFromLastEmail(EMAIL);
    expect(await service.resetPassword({ token, newPassword: 'nueva clave segura 1' })).toEqual({ ok: true });
    expect(await service.resetPassword({ token, newPassword: 'nueva clave segura 2' })).toEqual({ ok: false, reason: 'invalid_token' });
    expect(await service.refresh(session.refreshToken)).toBeNull();
    expect((await service.login({ email: EMAIL, password: 'nueva clave segura 1', deviceId: null, ip: IP })).status).toBe('code_required');

    await service.requestPasswordReset(EMAIL);
    const late = env.tokenFromLastEmail(EMAIL);
    env.clock.advance(31 * 60_000);
    expect(await service.resetPassword({ token: late, newPassword: 'nueva clave segura 3' })).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('changes the password only with the current one and notifies by email', async () => {
    await registerAndVerify();
    const { session } = await fullLogin();
    const actor = firstActor();

    const wrong = await service.changePassword(actor, { currentPassword: 'otra cosa', newPassword: 'nueva clave segura 1' });
    expect(wrong).toEqual({ ok: false, issues: [{ field: 'currentPassword', message: 'La contraseña actual no es correcta.' }] });

    const changed = await service.changePassword(actor, { currentPassword: PASSWORD, newPassword: 'nueva clave segura 1' });
    expect(changed.ok).toBe(true);
    expect(await service.refresh(session.refreshToken)).toBeNull();
    expect(env.lastEmail(EMAIL).subject).toBe('Cambiaste tu contraseña de Fin de Mes');
  });
});
