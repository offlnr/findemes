import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { PublicError } from '../http/error-handling.ts';
import type { AdminService } from '../modules/administration/application/admin-service.ts';
import type { AdminContext, PaymentOrderView } from '../modules/administration/ports/administration-ports.ts';

export interface AdminRoutesOptions {
  readonly admin: AdminService;
}

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const security = [{ bearerAuth: [] }];
const uuid = { type: 'string', format: 'uuid' } as const;
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const STATUSES = ['created', 'authorized', 'rejected', 'aborted', 'amount_mismatch'] as const;

function strict(properties: Record<string, unknown>, required: string[] = Object.keys(properties)) {
  return { type: 'object', additionalProperties: false, required, properties } as const;
}
const errorSchema = strict({ error: { type: 'string' }, message: { type: 'string' } });
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });

/**
 * Administration routes (HU22-HU26), only in the admin API process (rule 9). Every route except
 * the login requires an admin token, re-checked against platform_admins on each request.
 */
export const adminRoutes: FastifyPluginCallback<AdminRoutesOptions> = (app, options, done) => {
  const { admin } = options;

  const requireAdmin = async (request: FastifyRequest): Promise<AdminContext> => {
    const match = BEARER.exec(request.headers.authorization ?? '');
    const adminId = match?.[1] === undefined ? null : await admin.authenticate(match[1]);
    if (adminId === null) throw new PublicError(401, 'unauthorized', 'Se requiere una sesión de administración.');
    return { adminId, ip: request.ip };
  };
  const noStore = (reply: FastifyReply) => void reply.header('cache-control', 'no-store');

  app.post<{ Body: { email: string; password: string; code: string } }>(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        summary: 'Iniciar sesión en el panel con contraseña y código TOTP (HU22, RNF22)',
        tags: ['sesión'],
        body: strict({
          email: { type: 'string', minLength: 3, maxLength: 254 },
          password: { type: 'string', minLength: 1, maxLength: 256 },
          code: { type: 'string', pattern: '^\\d{6}$' },
        }),
        response: { 200: strict({ accessToken: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } }), 401: errorSchema, 429: errorSchema },
      },
    },
    async (request, reply) => {
      const result = await admin.login({ ...request.body, ip: request.ip });
      noStore(reply);
      if (result.ok) return { accessToken: result.token, expiresAt: result.expiresAt.toISOString() };
      if (result.reason === 'locked') {
        void reply.header('retry-after', String(Math.ceil(result.retryAfterMs / 1000)));
        return reply.status(429).send({ error: 'too_many_requests', message: 'Demasiados intentos. Espera unos minutos.' });
      }
      return reply.status(401).send({ error: 'invalid_credentials', message: 'Credenciales o código incorrectos.' });
    },
  );

  app.get<{ Querystring: { q?: string } }>(
    '/accounts',
    {
      schema: {
        summary: 'Buscar cuentas por correo: plan y estado de la suscripción (HU23)',
        description: 'Nunca incluye ingresos, gastos, deudas ni escenarios.',
        tags: ['cuentas'],
        security,
        querystring: strict({ q: { type: 'string', maxLength: 254 } }, []),
        response: {
          200: strict({
            accounts: {
              type: 'array',
              items: strict({
                id: uuid,
                email: { type: 'string' },
                status: { type: 'string', enum: ['active', 'suspended'] },
                emailVerified: { type: 'boolean' },
                createdAt: { type: 'string', format: 'date-time' },
                planCode: { type: 'string', enum: ['free', 'paid', 'family'] },
                periodEnd: nullable({ type: 'string' }),
                cancelAtPeriodEnd: { type: 'boolean' },
              }),
            },
          }),
          401: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await requireAdmin(request);
      const accounts = await admin.searchAccounts(context, request.query.q ?? '');
      noStore(reply);
      return { accounts: accounts.map((account) => ({ ...account, createdAt: account.createdAt.toISOString() })) };
    },
  );

  for (const [path, status, summary] of [
    ['suspend', 'suspended', 'Suspender una cuenta (HU23)'],
    ['reactivate', 'active', 'Reactivar una cuenta (HU23)'],
  ] as const) {
    app.post<{ Params: { id: string } }>(
      `/accounts/:id/${path}`,
      {
        schema: { summary, tags: ['cuentas'], security, params: strict({ id: uuid }), response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema, 409: errorSchema } },
      },
      async (request, reply) => {
        const result = await admin.setAccountStatus(await requireAdmin(request), request.params.id, status);
        if (result === 'self') return reply.status(409).send({ error: 'self', message: 'No puedes cambiar el estado de tu propia cuenta.' });
        return result === 'ok' ? reply.status(204).send() : reply.status(404).send({ error: 'not_found', message: 'Cuenta no encontrada.' });
      },
    );
  }

  app.get<{ Querystring: { limit?: string; beforeSeq?: string; actorId?: string; action?: string } }>(
    '/audit',
    {
      schema: {
        summary: 'Traza de auditoría, de la más reciente a la más antigua (HU25)',
        description: 'Solo lectura. brokenAtSeq indica la primera entrada cuya cadena de hash no coincide (null si está íntegra).',
        tags: ['auditoría'],
        security,
        querystring: strict(
          {
            limit: { type: 'string', pattern: '^([1-9]|[1-9][0-9]|1[0-9][0-9]|200)$' },
            beforeSeq: { type: 'string', pattern: '^[1-9][0-9]{0,15}$' },
            actorId: uuid,
            action: { type: 'string', pattern: '^[a-z][a-z0-9_.]{0,63}$' },
          },
          [],
        ),
        response: {
          200: strict({
            brokenAtSeq: nullable({ type: 'integer' }),
            entries: {
              type: 'array',
              items: strict({
                seq: { type: 'integer' },
                occurredAt: { type: 'string', format: 'date-time' },
                actorType: { type: 'string', enum: ['user', 'admin', 'system'] },
                actorId: nullable(uuid),
                action: { type: 'string' },
                targetType: { type: 'string' },
                targetId: nullable(uuid),
                originIp: nullable({ type: 'string' }),
              }),
            },
          }),
          401: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await requireAdmin(request);
      const { limit, beforeSeq, actorId, action } = request.query;
      const result = await admin.audit(context, {
        limit: limit === undefined ? 50 : Number(limit),
        ...(beforeSeq === undefined ? {} : { beforeSeq: Number(beforeSeq) }),
        ...(actorId === undefined ? {} : { actorId }),
        ...(action === undefined ? {} : { actionPrefix: action }),
      });
      noStore(reply);
      return { brokenAtSeq: result.brokenAtSeq, entries: result.entries.map((entry) => ({ ...entry, occurredAt: entry.occurredAt.toISOString() })) };
    },
  );

  const iso = (value: Date | null) => value?.toISOString() ?? null;
  app.get<{ Querystring: { status?: PaymentOrderView['status']; from?: string; to?: string } }>(
    '/payments',
    {
      schema: {
        summary: 'Transacciones de suscripción por estado y período, con inconsistencias marcadas (HU26)',
        tags: ['pagos'],
        security,
        querystring: strict({ status: { type: 'string', enum: [...STATUSES] }, from: date, to: date }, []),
        response: {
          200: strict({
            payments: {
              type: 'array',
              items: strict({
                buyOrder: { type: 'string' },
                userId: nullable(uuid),
                planCode: { type: 'string' },
                amount: { type: 'integer' },
                status: { type: 'string', enum: [...STATUSES] },
                authorizedAmount: nullable({ type: 'integer' }),
                responseCode: nullable({ type: 'string' }),
                createdAt: { type: 'string', format: 'date-time' },
                committedAt: nullable({ type: 'string', format: 'date-time' }),
                activatedAt: nullable({ type: 'string', format: 'date-time' }),
                hasProviderToken: { type: 'boolean' },
                flags: { type: 'array', items: { type: 'string', enum: ['monto_distinto', 'sin_confirmar', 'autorizada_sin_activar'] } },
              }),
            },
          }),
          401: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await requireAdmin(request);
      const { status, from, to } = request.query;
      const payments = await admin.payments(context, { limit: 200, ...(status === undefined ? {} : { status }), ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) });
      noStore(reply);
      return {
        payments: payments.map((order) => ({ ...order, createdAt: order.createdAt.toISOString(), committedAt: iso(order.committedAt), activatedAt: iso(order.activatedAt) })),
      };
    },
  );

  app.post<{ Params: { buyOrder: string } }>(
    '/payments/:buyOrder/reconcile',
    {
      schema: {
        summary: 'Conciliar una orden con Transbank (HU26)',
        description: 'Consulta el estado de la transacción en Webpay y lo compara con el registro propio. No modifica nada.',
        tags: ['pagos'],
        security,
        params: strict({ buyOrder: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,26}$' } }),
        response: {
          200: strict({ flag: { type: 'string', enum: ['cobro_sin_activacion', 'activacion_sin_cobro', 'monto_distinto', 'sin_diferencias'] }, providerStatus: { type: 'string' } }),
          401: errorSchema,
          404: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await admin.reconcile(await requireAdmin(request), request.params.buyOrder);
      if (result === 'not_found') return reply.status(404).send({ error: 'not_found', message: 'La orden no existe o no llegó a Webpay.' });
      if (result === 'unavailable') return reply.status(503).send({ error: 'unavailable', message: 'La consulta a Webpay no está configurada.' });
      return result;
    },
  );

  app.get(
    '/metrics',
    {
      schema: {
        summary: 'Indicadores agregados y estado de la API pública (HU24, KPI de registro inicial)',
        tags: ['monitoreo'],
        security,
        response: {
          200: strict({
            users: { type: 'integer' },
            verifiedUsers: { type: 'integer' },
            suspendedUsers: { type: 'integer' },
            onboardingStarted: { type: 'integer' },
            onboardingCompleted: { type: 'integer' },
            onboardingMedianMinutes: nullable({ type: 'integer' }),
            activeSubscriptions: { type: 'object', additionalProperties: { type: 'integer' } },
            publicApi: nullable(strict({ up: { type: 'boolean' }, latencyMs: nullable({ type: 'integer' }) })),
          }),
          401: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const context = await requireAdmin(request);
      noStore(reply);
      return admin.metrics(context);
    },
  );

  done();
};
