import type { EmailSender } from '../../notifications/ports/notification-ports.ts';
import type { Actor, UserId } from '../../shared/actor.ts';
import type { Clock } from '../../shared/ports.ts';
import { displayNameIssue, emailIssue, normalizeEmail, passwordIssue, type FieldIssue } from '../domain/account-rules.ts';
import { SESSION_POLICY } from '../domain/session-policy.ts';
import type {
  AccessTokenService,
  BreachedPasswordList,
  EmailTokenStore,
  LoginAttemptLimiter,
  LoginChallengeStore,
  PasswordHasher,
  RefreshTokenStore,
  SecretTools,
  TrustedDeviceStore,
  UserAccountRepository,
} from '../ports/identity-ports.ts';

export interface IdentityDependencies {
  readonly accounts: UserAccountRepository;
  readonly hasher: PasswordHasher;
  readonly breached: BreachedPasswordList;
  readonly accessTokens: AccessTokenService;
  readonly refreshTokens: RefreshTokenStore;
  readonly emailTokens: EmailTokenStore;
  readonly challenges: LoginChallengeStore;
  readonly devices: TrustedDeviceStore;
  readonly limiter: LoginAttemptLimiter;
  readonly secrets: SecretTools;
  readonly email: EmailSender;
  readonly clock: Clock;
  /** Public URL of the web app, used in email links (e.g. https://app.findemes.cl). */
  readonly appBaseUrl: string;
  /** A valid argon2id hash verified when the account does not exist, to equalize timing. */
  readonly dummyPasswordHash: string;
}

export interface Session {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

export type LoginResult =
  | { readonly status: 'authenticated'; readonly session: Session; readonly deviceId: string }
  | { readonly status: 'code_required'; readonly challengeId: string; readonly deviceId: string }
  | { readonly status: 'locked'; readonly retryAfterMs: number }
  /** Same answer whether the email exists or the password is wrong (HU17.1). */
  | { readonly status: 'invalid_credentials' }
  | { readonly status: 'email_not_verified' }
  | { readonly status: 'suspended' };

type Validation = { readonly ok: true } | { readonly ok: false; readonly issues: readonly FieldIssue[] };

const asActor = (userId: UserId): Actor => ({ userId });

/**
 * Account and session use cases (HU17, HU17.1-HU17.4, CU-08, CU-11). Every answer that could
 * reveal whether an email is registered is identical in both cases.
 */
export class IdentityService {
  private readonly deps: IdentityDependencies;

  constructor(deps: IdentityDependencies) {
    this.deps = deps;
  }

  /** HU17. Answers the same whether or not the email is taken; the owner gets a notice instead. */
  async register(input: { readonly email: string; readonly password: string; readonly displayName: string }): Promise<Validation> {
    const issues = [
      emailIssue(input.email),
      displayNameIssue(input.displayName),
      passwordIssue(input.password, (p) => this.deps.breached.contains(p)),
    ].filter((issue) => issue !== null);
    if (issues.length > 0) {
      return { ok: false, issues };
    }

    const email = normalizeEmail(input.email);
    const passwordHash = await this.deps.hasher.hash(input.password);
    const created = await this.deps.accounts.create({ email, displayName: input.displayName.trim(), passwordHash });
    if (created === 'email_taken') {
      await this.deps.email.send({
        to: email,
        subject: 'Intento de registro en Fin de Mes',
        text:
          'Alguien intentó crear una cuenta en Fin de Mes con este correo, que ya tiene una cuenta. ' +
          `Si fuiste tú, inicia sesión o recupera tu contraseña en ${this.deps.appBaseUrl}/#/login. ` +
          'Si no fuiste tú, puedes ignorar este mensaje.',
      });
      return { ok: true };
    }

    await this.sendVerification(created, email);
    return { ok: true };
  }

  /** HU17: the account becomes usable when the single-use link is confirmed. */
  async verifyEmail(token: string): Promise<boolean> {
    return (await this.deps.emailTokens.consume(this.deps.secrets.sha256(token), 'verify_email')) !== null;
  }

  /**
   * HU17.1 and CU-11. `deviceId` is the random identifier the client keeps; a new one is issued
   * when missing. An unrecognized or stale device must confirm a code sent by email.
   */
  async login(input: { readonly email: string; readonly password: string; readonly deviceId: string | null; readonly ip: string }): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const retryAfterMs = await this.deps.limiter.retryAfterMs(email, input.ip);
    if (retryAfterMs > 0) {
      return { status: 'locked', retryAfterMs };
    }

    const record = await this.deps.accounts.lookupLogin(email);
    // Always run argon2id so response time does not reveal whether the account exists.
    const passwordOk = await this.deps.hasher.verify(record?.passwordHash ?? this.deps.dummyPasswordHash, input.password);
    if (record === null || !passwordOk) {
      await this.deps.limiter.recordFailure(email, input.ip);
      return { status: 'invalid_credentials' };
    }
    await this.deps.limiter.recordSuccess(email);

    if (record.status !== 'active') {
      return { status: 'suspended' };
    }
    if (record.emailVerifiedAt === null) {
      return { status: 'email_not_verified' };
    }

    const actor = asActor(record.userId);
    const deviceId = input.deviceId ?? this.deps.secrets.opaqueToken();
    const deviceHash = this.deps.secrets.sha256(deviceId);
    const verifiedAt = await this.deps.devices.lastVerifiedAt(actor, deviceHash);
    const now = this.deps.clock.now().getTime();
    if (verifiedAt === null || now - verifiedAt.getTime() > SESSION_POLICY.deviceTrustMs) {
      const code = this.deps.secrets.sixDigitCode();
      const challengeId = await this.deps.challenges.create(
        actor,
        deviceHash,
        this.deps.secrets.hmac(code),
        new Date(now + SESSION_POLICY.loginCodeMs),
      );
      await this.deps.email.send({
        to: email,
        subject: 'Tu código para entrar a Fin de Mes',
        text: `Tu código es ${code}. Vence en 10 minutos. Si no intentaste entrar, cambia tu contraseña.`,
      });
      return { status: 'code_required', challengeId, deviceId };
    }

    return { status: 'authenticated', session: await this.startSession(record.userId), deviceId };
  }

  /** CU-11: a right code trusts the device for 30 days and opens the session. */
  async confirmLoginCode(input: { readonly challengeId: string; readonly code: string }): Promise<Session | null> {
    if (!/^\d{6}$/.test(input.code)) {
      return null;
    }
    const userId = await this.deps.challenges.consume(input.challengeId, this.deps.secrets.hmac(input.code));
    return userId === null ? null : this.startSession(userId);
  }

  /** Rotates the refresh token (HU17.3). A reused token revokes its whole family. */
  async refresh(refreshToken: string): Promise<Session | null> {
    const next = this.deps.secrets.opaqueToken();
    const expiresAt = this.refreshExpiry();
    const rotated = await this.deps.refreshTokens.rotate(this.deps.secrets.sha256(refreshToken), this.deps.secrets.sha256(next), expiresAt);
    if (rotated.status !== 'rotated') {
      return null;
    }
    const access = await this.deps.accessTokens.issue(rotated.userId);
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken: next, refreshTokenExpiresAt: expiresAt };
  }

  /** HU17.3: closes this session. */
  async logout(actor: Actor, refreshToken: string): Promise<void> {
    await this.deps.refreshTokens.revokeFamily(actor, this.deps.secrets.sha256(refreshToken));
  }

  /** HU17.3: closes every session and forgets the recognized devices. */
  async logoutEverywhere(actor: Actor): Promise<void> {
    await this.deps.refreshTokens.revokeAllForUser(actor);
    await this.deps.devices.removeAll(actor);
  }

  /** HU17.2: same answer whether or not the account exists. */
  async requestPasswordReset(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const record = emailIssue(normalized) === null ? await this.deps.accounts.lookupLogin(normalized) : null;
    if (record?.status !== 'active') {
      return;
    }
    const token = this.deps.secrets.opaqueToken();
    await this.deps.emailTokens.create(
      asActor(record.userId),
      'reset_password',
      this.deps.secrets.sha256(token),
      new Date(this.deps.clock.now().getTime() + SESSION_POLICY.passwordResetMs),
    );
    await this.deps.email.send({
      to: normalized,
      subject: 'Restablece tu contraseña de Fin de Mes',
      text:
        `Para elegir una nueva contraseña abre este enlace: ${this.deps.appBaseUrl}/#/restablecer?token=${token} . ` +
        'Sirve una sola vez y vence en 30 minutos. Si no lo pediste, ignora este mensaje.',
    });
  }

  /** HU17.2: single-use link; the change closes every open session and forgets devices. */
  async resetPassword(input: { readonly token: string; readonly newPassword: string }): Promise<Validation | { readonly ok: false; readonly reason: 'invalid_token' }> {
    const issue = passwordIssue(input.newPassword, (p) => this.deps.breached.contains(p), 'newPassword');
    if (issue !== null) {
      return { ok: false, issues: [issue] };
    }
    const userId = await this.deps.emailTokens.consume(this.deps.secrets.sha256(input.token), 'reset_password');
    if (userId === null) {
      return { ok: false, reason: 'invalid_token' };
    }
    const actor = asActor(userId);
    await this.deps.accounts.updatePassword(actor, await this.deps.hasher.hash(input.newPassword));
    await this.logoutEverywhere(actor);
    return { ok: true };
  }

  /** HU17.4: requires the current password, closes the other sessions and notifies by email. */
  async changePassword(
    actor: Actor,
    input: { readonly currentPassword: string; readonly newPassword: string },
  ): Promise<{ readonly ok: true; readonly session: Session } | { readonly ok: false; readonly issues: readonly FieldIssue[] }> {
    const currentHash = await this.deps.accounts.passwordHash(actor);
    if (currentHash === null || !(await this.deps.hasher.verify(currentHash, input.currentPassword))) {
      return { ok: false, issues: [{ field: 'currentPassword', message: 'La contraseña actual no es correcta.' }] };
    }
    const issue = passwordIssue(input.newPassword, (p) => this.deps.breached.contains(p), 'newPassword');
    if (issue !== null) {
      return { ok: false, issues: [issue] };
    }
    await this.deps.accounts.updatePassword(actor, await this.deps.hasher.hash(input.newPassword));
    await this.deps.refreshTokens.revokeAllForUser(actor);
    const account = await this.deps.accounts.findSelf(actor);
    if (account !== null) {
      await this.deps.email.send({
        to: account.email,
        subject: 'Cambiaste tu contraseña de Fin de Mes',
        text: 'La contraseña de tu cuenta se cambió y se cerraron las sesiones en otros dispositivos. Si no fuiste tú, restablécela de inmediato.',
      });
    }
    return { ok: true, session: await this.startSession(actor.userId) };
  }

  private async startSession(userId: UserId): Promise<Session> {
    const refreshToken = this.deps.secrets.opaqueToken();
    const refreshTokenExpiresAt = this.refreshExpiry();
    await this.deps.refreshTokens.create(asActor(userId), this.deps.secrets.sha256(refreshToken), refreshTokenExpiresAt);
    const access = await this.deps.accessTokens.issue(userId);
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt, refreshToken, refreshTokenExpiresAt };
  }

  private refreshExpiry(): Date {
    return new Date(this.deps.clock.now().getTime() + SESSION_POLICY.refreshTokenMs);
  }

  private async sendVerification(userId: UserId, email: string): Promise<void> {
    const token = this.deps.secrets.opaqueToken();
    await this.deps.emailTokens.create(
      asActor(userId),
      'verify_email',
      this.deps.secrets.sha256(token),
      new Date(this.deps.clock.now().getTime() + SESSION_POLICY.emailVerificationMs),
    );
    await this.deps.email.send({
      to: email,
      subject: 'Confirma tu correo en Fin de Mes',
      text:
        `Para activar tu cuenta abre este enlace: ${this.deps.appBaseUrl}/#/verificar?token=${token} . ` +
        'Vence en 24 horas. Si no creaste una cuenta, ignora este mensaje.',
    });
  }
}
