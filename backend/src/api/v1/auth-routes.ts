import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { IdentityService, Session } from '../../modules/identity/application/identity-service.ts';
import type { FieldIssue } from '../../modules/identity/domain/account-rules.ts';
import { SESSION_POLICY } from '../../modules/identity/domain/session-policy.ts';
import type { AccessTokenService, UserAccountRepository } from '../../modules/identity/ports/identity-ports.ts';
import { noStore, requireActor } from './authenticate.ts';

export interface AuthServices {
  readonly identity: IdentityService;
  readonly accessTokens: AccessTokenService;
  readonly accounts: Pick<UserAccountRepository, 'findSelf'>;
}

export interface AuthRoutesOptions extends AuthServices {
  /** Secure cookies need HTTPS; only local development over plain HTTP turns this off. */
  readonly secureCookies: boolean;
}

/** Per client IP, on top of the per-account lockout (HU17.1). */
export const AUTH_RATE_LIMIT = Object.freeze({ max: 20, timeWindow: '1 minute' });

const REFRESH_COOKIE = 'fdm_refresh';
const DEVICE_COOKIE = 'fdm_device';
const COOKIE_PATH = '/v1/auth';
const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 3600;
const TAGS = ['identidad y sesión'];

// ---- Schemas ----

const email = { type: 'string', minLength: 3, maxLength: 254 } as const;
const password = { type: 'string', minLength: 1, maxLength: 512 } as const;
const opaque = { type: 'string', minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' } as const;
const client = {
  type: 'string',
  enum: ['web', 'mobile'],
  description: 'web: el refresh token y el dispositivo viajan en cookies HttpOnly. mobile: en el cuerpo (flutter_secure_storage).',
} as const;

function body(properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', additionalProperties: false, required, properties } as const;
}

const sessionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['accessToken', 'accessTokenExpiresAt'],
  properties: {
    accessToken: { type: 'string', description: 'JWT de 15 minutos; en la web se guarda solo en memoria.' },
    accessTokenExpiresAt: { type: 'string', format: 'date-time' },
    refreshToken: { type: 'string', description: 'Solo para clientes mobile.' },
    refreshTokenExpiresAt: { type: 'string', format: 'date-time' },
    deviceId: { type: 'string', description: 'Solo para clientes mobile.' },
  },
} as const;

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'message'],
  properties: { error: { type: 'string' }, message: { type: 'string' } },
} as const;

const issuesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'message', 'issues'],
  properties: {
    error: { type: 'string', enum: ['invalid_fields'] },
    message: { type: 'string' },
    issues: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['field', 'message'], properties: { field: { type: 'string' }, message: { type: 'string' } } },
    },
  },
} as const;

const accepted = { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string' } } } as const;

// ---- Route plugin ----

/** HU17, HU17.1-HU17.4, CU-08, CU-11. Public routes are rate limited per IP. */
export const authRoutes: FastifyPluginCallback<AuthRoutesOptions> = (app, options, done) => {
  const { identity, accessTokens, accounts } = options;
  const limited = { rateLimit: AUTH_RATE_LIMIT };

  const cookieOptions = (maxAgeSeconds: number) => ({
    httpOnly: true,
    secure: options.secureCookies,
    sameSite: 'strict' as const,
    path: COOKIE_PATH,
    maxAge: maxAgeSeconds,
  });

  /** Web: refresh token and device id in HttpOnly cookies. Mobile: both in the body. */
  const sendSession = (reply: FastifyReply, kind: 'web' | 'mobile', session: Session, deviceId?: string) => {
    noStore(reply);
    if (kind === 'web') {
      void reply.setCookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(SESSION_POLICY.refreshTokenMs / 1000));
      if (deviceId !== undefined) void reply.setCookie(DEVICE_COOKIE, deviceId, cookieOptions(DEVICE_COOKIE_MAX_AGE_S));
      return { accessToken: session.accessToken, accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString() };
    }
    return {
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
      ...(deviceId === undefined ? {} : { deviceId }),
    };
  };

  const invalidFields = (reply: FastifyReply, issues: readonly FieldIssue[]) =>
    reply.status(400).send({ error: 'invalid_fields', message: 'Revisa los datos ingresados.', issues });

  const refreshTokenOf = (request: FastifyRequest, fromBody: string | undefined) => fromBody ?? request.cookies[REFRESH_COOKIE];

  app.post<{ Body: { email: string; password: string; displayName: string } }>(
    '/auth/register',
    {
      config: limited,
      schema: {
        summary: 'Crear una cuenta (HU17)',
        description: 'La respuesta es la misma exista o no una cuenta con ese correo; se envía un enlace de verificación.',
        tags: TAGS,
        body: body({ email, password, displayName: { type: 'string', maxLength: 80 } }, ['email', 'password', 'displayName']),
        response: { 202: accepted, 400: issuesSchema },
      },
    },
    async (request, reply) => {
      const result = await identity.register(request.body);
      if (!result.ok) return invalidFields(reply, result.issues);
      return reply.status(202).send({ message: 'Te enviamos un correo para confirmar tu cuenta.' });
    },
  );

  app.post<{ Body: { token: string } }>(
    '/auth/verify-email',
    {
      config: limited,
      schema: { summary: 'Confirmar el correo (HU17)', tags: TAGS, body: body({ token: opaque }, ['token']), response: { 204: { type: 'null' }, 400: errorSchema } },
    },
    async (request, reply) => {
      if (!(await identity.verifyEmail(request.body.token))) {
        return reply.status(400).send({ error: 'invalid_token', message: 'El enlace no es válido o ya venció.' });
      }
      return reply.status(204).send();
    },
  );

  app.post<{ Body: { email: string; password: string; client?: 'web' | 'mobile'; deviceId?: string } }>(
    '/auth/login',
    {
      config: limited,
      schema: {
        summary: 'Iniciar sesión (HU17.1, CU-11)',
        description:
          'Un dispositivo no reconocido recibe un código por correo y debe confirmarlo en /v1/auth/login/code. ' +
          'Correo inexistente y contraseña incorrecta reciben la misma respuesta.',
        tags: TAGS,
        body: body({ email, password, client, deviceId: opaque }, ['email', 'password']),
        response: {
          200: {
            oneOf: [
              { type: 'object', additionalProperties: false, required: ['status', 'session'], properties: { status: { type: 'string', enum: ['authenticated'] }, session: sessionSchema } },
              {
                type: 'object',
                additionalProperties: false,
                required: ['status', 'challengeId'],
                properties: { status: { type: 'string', enum: ['code_required'] }, challengeId: { type: 'string' }, deviceId: { type: 'string' } },
              },
            ],
          },
          401: errorSchema,
          403: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const kind = request.body.client ?? 'web';
      const deviceId = (kind === 'web' ? request.cookies[DEVICE_COOKIE] : request.body.deviceId) ?? null;
      const result = await identity.login({ email: request.body.email, password: request.body.password, deviceId, ip: request.ip });

      switch (result.status) {
        case 'authenticated':
          return { status: 'authenticated', session: sendSession(reply, kind, result.session, result.deviceId) };
        case 'code_required':
          noStore(reply);
          if (kind === 'web') {
            void reply.setCookie(DEVICE_COOKIE, result.deviceId, cookieOptions(DEVICE_COOKIE_MAX_AGE_S));
            return { status: 'code_required', challengeId: result.challengeId };
          }
          return { status: 'code_required', challengeId: result.challengeId, deviceId: result.deviceId };
        case 'locked':
          void reply.header('retry-after', String(Math.ceil(result.retryAfterMs / 1000)));
          return reply.status(429).send({ error: 'too_many_requests', message: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' });
        case 'invalid_credentials':
          return reply.status(401).send({ error: 'invalid_credentials', message: 'Correo o contraseña incorrectos.' });
        case 'email_not_verified':
          return reply.status(403).send({ error: 'email_not_verified', message: 'Confirma tu correo con el enlace que te enviamos.' });
        case 'suspended':
          return reply.status(403).send({ error: 'account_suspended', message: 'La cuenta está suspendida.' });
      }
    },
  );

  app.post<{ Body: { challengeId: string; code: string; client?: 'web' | 'mobile' } }>(
    '/auth/login/code',
    {
      config: limited,
      schema: {
        summary: 'Confirmar el código de inicio de sesión (CU-11)',
        tags: TAGS,
        body: body({ challengeId: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^\\d{6}$' }, client }, ['challengeId', 'code']),
        response: { 200: sessionSchema, 401: errorSchema },
      },
    },
    async (request, reply) => {
      const session = await identity.confirmLoginCode(request.body);
      if (session === null) {
        return reply.status(401).send({ error: 'invalid_code', message: 'El código no es válido o ya venció.' });
      }
      return sendSession(reply, request.body.client ?? 'web', session);
    },
  );

  app.post<{ Body: { refreshToken?: string } | undefined }>(
    '/auth/refresh',
    {
      config: limited,
      schema: {
        summary: 'Renovar la sesión (rota el refresh token)',
        description: 'La web envía la cookie; mobile envía refreshToken en el cuerpo. Reusar un token ya usado revoca la sesión completa.',
        tags: TAGS,
        body: { anyOf: [body({ refreshToken: opaque }, []), { type: 'null' }] },
        response: { 200: sessionSchema, 401: errorSchema },
      },
    },
    async (request, reply) => {
      const fromBody = request.body?.refreshToken;
      const token = refreshTokenOf(request, fromBody);
      const session = token === undefined ? null : await identity.refresh(token);
      if (session === null) {
        void reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
        return reply.status(401).send({ error: 'unauthorized', message: 'La sesión terminó. Inicia sesión de nuevo.' });
      }
      return sendSession(reply, fromBody === undefined ? 'web' : 'mobile', session);
    },
  );

  app.post<{ Body: { refreshToken?: string } | undefined }>(
    '/auth/logout',
    {
      schema: {
        summary: 'Cerrar esta sesión (HU17.3)',
        tags: TAGS,
        security: [{ bearerAuth: [] }],
        body: { anyOf: [body({ refreshToken: opaque }, []), { type: 'null' }] },
        response: { 204: { type: 'null' }, 401: errorSchema },
      },
    },
    async (request, reply) => {
      const actor = await requireActor(request, accessTokens);
      const token = refreshTokenOf(request, request.body?.refreshToken);
      if (token !== undefined) await identity.logout(actor, token);
      void reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      return reply.status(204).send();
    },
  );

  app.post(
    '/auth/logout-all',
    {
      schema: { summary: 'Cerrar todas las sesiones (HU17.3)', tags: TAGS, security: [{ bearerAuth: [] }], response: { 204: { type: 'null' }, 401: errorSchema } },
    },
    async (request, reply) => {
      await identity.logoutEverywhere(await requireActor(request, accessTokens));
      void reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      void reply.clearCookie(DEVICE_COOKIE, { path: COOKIE_PATH });
      return reply.status(204).send();
    },
  );

  app.post<{ Body: { email: string } }>(
    '/auth/password-reset',
    {
      config: limited,
      schema: {
        summary: 'Pedir un enlace para restablecer la contraseña (HU17.2)',
        description: 'La respuesta es la misma exista o no la cuenta.',
        tags: TAGS,
        body: body({ email }, ['email']),
        response: { 202: accepted },
      },
    },
    async (request, reply) => {
      await identity.requestPasswordReset(request.body.email);
      return reply.status(202).send({ message: 'Si el correo tiene una cuenta, te enviamos un enlace para restablecer la contraseña.' });
    },
  );

  app.post<{ Body: { token: string; newPassword: string } }>(
    '/auth/password-reset/confirm',
    {
      config: limited,
      schema: {
        summary: 'Elegir una nueva contraseña con el enlace (HU17.2)',
        description: 'El enlace sirve una vez y vence en 30 minutos; el cambio cierra todas las sesiones.',
        tags: TAGS,
        body: body({ token: opaque, newPassword: password }, ['token', 'newPassword']),
        response: { 204: { type: 'null' }, 400: { oneOf: [issuesSchema, errorSchema] } },
      },
    },
    async (request, reply) => {
      const result = await identity.resetPassword(request.body);
      if (result.ok) return reply.status(204).send();
      if ('issues' in result) return invalidFields(reply, result.issues);
      return reply.status(400).send({ error: 'invalid_token', message: 'El enlace no es válido o ya venció.' });
    },
  );

  app.post<{ Body: { currentPassword: string; newPassword: string; client?: 'web' | 'mobile' } }>(
    '/auth/password',
    {
      schema: {
        summary: 'Cambiar la contraseña (HU17.4)',
        description: 'Exige la contraseña vigente, cierra las otras sesiones y avisa por correo.',
        tags: TAGS,
        security: [{ bearerAuth: [] }],
        body: body({ currentPassword: password, newPassword: password, client }, ['currentPassword', 'newPassword']),
        response: { 200: sessionSchema, 400: issuesSchema, 401: errorSchema },
      },
    },
    async (request, reply) => {
      const actor = await requireActor(request, accessTokens);
      const result = await identity.changePassword(actor, request.body);
      if (!result.ok) return invalidFields(reply, result.issues);
      return sendSession(reply, request.body.client ?? 'web', result.session);
    },
  );

  app.get(
    '/me',
    {
      schema: {
        summary: 'Datos de la cuenta autenticada',
        tags: TAGS,
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'email', 'displayName'],
            properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string' }, displayName: { type: 'string' } },
          },
          401: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = await requireActor(request, accessTokens);
      const account = await accounts.findSelf(actor);
      noStore(reply);
      if (account === null) {
        return reply.status(401).send({ error: 'unauthorized', message: 'Se requiere autenticación.' });
      }
      return { id: account.id, email: account.email, displayName: account.displayName };
    },
  );

  done();
};
