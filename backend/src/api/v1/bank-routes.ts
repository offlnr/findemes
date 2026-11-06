import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { AggregationRefusal, AggregationService, ConnectInput } from '../../modules/aggregation/application/aggregation-service.ts';
import type { AccessTokenService } from '../../modules/identity/ports/identity-ports.ts';
import { noStore, requireActor } from './authenticate.ts';
import { badRequestSchema } from './common-schemas.ts';
import { id, label, scheduleFromJson, scheduleSchema, strict, type ScheduleJson } from './schedule-schema.ts';

export interface BankRoutesOptions {
  readonly aggregation: AggregationService;
  readonly accessTokens: AccessTokenService;
}

const TAGS = ['banco'];
const security = [{ bearerAuth: [] }];
const errorSchema = strict({ error: { type: 'string' }, message: { type: 'string' } });
const origin = {
  type: 'string',
  enum: ['real', 'provider_test', 'demo'],
  description: 'real: datos del banco. provider_test: modo de prueba de Fintoc (datos ficticios). demo: banco de demostración. La app rotula lo que no es real.',
} as const;
const refusals = { 400: badRequestSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema, 502: errorSchema, 503: errorSchema };

const accountView = strict({ id, name: { type: 'string' }, type: { type: 'string' }, availableBalance: { type: 'integer' }, origin });
const linkView = strict({
  id,
  provider: { type: 'string', enum: ['fintoc', 'demo'] },
  institutionName: { type: 'string' },
  origin,
  status: { type: 'string', enum: ['active', 'revoked'] },
  connectedAt: { type: 'string', format: 'date-time' },
  lastSyncedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  accounts: { type: 'array', items: accountView },
});
const movementView = strict({
  id,
  accountId: id,
  postedOn: { type: 'string', format: 'date' },
  amount: { type: 'integer', description: 'Negativo = cargo; positivo = abono.' },
  description: { type: 'string', description: 'Texto del banco, sin interpretar.' },
  origin,
  confirmedAs: { anyOf: [{ type: 'string', enum: ['income', 'expense'] }, { type: 'null' }] },
});

/** HU36 (ADR-002). Bank data is individual: only the actor's own links, accounts and movements. */
export const bankRoutes: FastifyPluginCallback<BankRoutesOptions> = (app, options, done) => {
  const { aggregation, accessTokens } = options;
  const context = async (request: FastifyRequest) => ({ actor: await requireActor(request, accessTokens), ip: request.ip });

  const refuse = (reply: FastifyReply, refusal: AggregationRefusal) => {
    switch (refusal.reason) {
      case 'consent_required':
        return reply.status(409).send({ error: 'consent_required', message: 'Para conectar un banco debes aceptar antes el consentimiento de conexión bancaria.' });
      case 'provider_unavailable':
        return reply.status(503).send({ error: 'provider_unavailable', message: 'La conexión con Fintoc no está configurada en este ambiente. Puedes usar el banco de demostración.' });
      case 'not_found':
        return reply.status(404).send({ error: 'not_found', message: 'Recurso no encontrado.' });
      case 'invalid':
        return reply.status(400).send({ error: 'invalid_fields', message: refusal.message, issues: [{ field: refusal.field, message: refusal.message }] });
    }
  };

  /** A provider failure is reported without its details (they may carry tokens). */
  const guarded = async <T>(reply: FastifyReply, work: () => Promise<T>): Promise<T | FastifyReply> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Error && /^(Fintoc|Unknown demo)/.test(error.message)) {
        app.log.warn({ provider_error: error.name }, 'bank provider call failed');
        return reply.status(502).send({ error: 'provider_error', message: 'El banco no respondió. Intenta de nuevo en unos minutos.' });
      }
      throw error;
    }
  };

  app.get(
    '/bank/providers',
    {
      schema: {
        summary: 'Formas de conectar un banco en este ambiente (HU36)',
        tags: TAGS,
        security,
        response: {
          200: strict({
            fintoc: strict({ available: { type: 'boolean' }, mode: { type: 'string', enum: ['test'] } }),
            demoProfiles: { type: 'array', items: strict({ id: { type: 'string' }, label: { type: 'string' } }) },
          }),
          401: errorSchema,
        },
      },
    },
    async (request) => {
      await requireActor(request, accessTokens);
      const providers = aggregation.providers();
      return { fintoc: { available: providers.fintoc, mode: 'test' as const }, demoProfiles: providers.demoProfiles };
    },
  );

  app.post(
    '/bank/fintoc/link-intents',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        summary: 'Abrir el widget de Fintoc (HU36)',
        description: 'Devuelve el token del widget y la llave pública. La clave del banco se ingresa solo en el widget de Fintoc.',
        tags: TAGS,
        security,
        response: { 201: strict({ widgetToken: { type: 'string' }, publicKey: { type: 'string' } }), ...refusals },
      },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      return guarded(reply, async () => {
        const result = await aggregation.fintocIntent(actor);
        noStore(reply);
        return result.ok ? reply.status(201).send({ widgetToken: result.widgetToken, publicKey: result.publicKey }) : refuse(reply, result);
      });
    },
  );

  app.post<{ Body: ConnectInput }>(
    '/bank/links',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        summary: 'Conectar un banco y sincronizar sus movimientos (HU36)',
        description: 'Fintoc: con el exchange token que entrega el widget. Demostración: con un perfil del banco de demostración. Requiere el consentimiento bank_connection vigente.',
        tags: TAGS,
        security,
        body: {
          oneOf: [
            strict({ provider: { type: 'string', enum: ['fintoc'] }, exchangeToken: { type: 'string', minLength: 1, maxLength: 256 } }),
            strict({ provider: { type: 'string', enum: ['demo'] }, profileId: { type: 'string', minLength: 1, maxLength: 64 } }),
          ],
        },
        response: { 201: strict({ id }), ...refusals },
      },
    },
    async (request, reply) => {
      const ctx = await context(request);
      return guarded(reply, async () => {
        const result = await aggregation.connect(ctx, request.body);
        return result.ok ? reply.status(201).send({ id: result.id }) : refuse(reply, result);
      });
    },
  );

  app.get(
    '/bank/links',
    {
      schema: { summary: 'Mis bancos conectados y sus cuentas (HU36)', tags: TAGS, security, response: { 200: strict({ links: { type: 'array', items: linkView } }), 401: errorSchema } },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      const { links, accounts } = await aggregation.overview(actor);
      noStore(reply);
      return {
        links: links.map((link) => ({
          id: link.id,
          provider: link.provider,
          institutionName: link.institutionName,
          origin: link.origin,
          status: link.status,
          connectedAt: link.createdAt.toISOString(),
          lastSyncedAt: link.lastSyncedAt?.toISOString() ?? null,
          accounts: accounts
            .filter((account) => account.linkId === link.id)
            .map((account) => ({ id: account.id, name: account.name, type: account.type, availableBalance: account.availableBalance, origin: account.origin })),
        })),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/bank/links/:id/sync',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { summary: 'Sincronizar de nuevo un banco (HU36)', tags: TAGS, security, params: strict({ id }), response: { 204: { type: 'null' }, ...refusals } },
    },
    async (request, reply) => {
      const ctx = await context(request);
      return guarded(reply, async () => {
        const result = await aggregation.sync(ctx, request.params.id);
        return result.ok ? reply.status(204).send() : refuse(reply, result);
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/bank/links/:id',
    {
      schema: {
        summary: 'Desconectar un banco (HU36, HU21)',
        description: 'Revoca el acceso en Fintoc y borra sus cuentas y movimientos. Lo que confirmaste en tu registro se mantiene.',
        tags: TAGS,
        security,
        params: strict({ id }),
        response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) =>
      (await aggregation.disconnect(await context(request), request.params.id))
        ? reply.status(204).send()
        : reply.status(404).send({ error: 'not_found', message: 'Recurso no encontrado.' }),
  );

  app.get<{ Querystring: { accountId?: string; months?: string } }>(
    '/bank/movements',
    {
      schema: {
        summary: 'Movimientos y totales por mes (HU36)',
        description: 'Se muestran tal como llegan, con la suma de abonos y cargos de cada mes. El sistema no clasifica ni califica movimientos.',
        tags: TAGS,
        security,
        querystring: strict({ accountId: id, months: { type: 'string', pattern: '^([1-9]|1[0-2])$' } }, []),
        response: {
          200: strict({
            movements: { type: 'array', items: movementView },
            totals: { type: 'array', items: strict({ month: { type: 'string' }, credits: { type: 'integer' }, debits: { type: 'integer' } }) },
          }),
          400: badRequestSchema,
          401: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      const result = await aggregation.movements(actor, {
        months: request.query.months === undefined ? 3 : Number(request.query.months),
        ...(request.query.accountId === undefined ? {} : { accountId: request.query.accountId }),
      });
      noStore(reply);
      return result;
    },
  );

  app.post<{ Params: { id: string }; Body: { label: string; schedule?: ScheduleJson; nature?: 'fixed' | 'variable_estimate' } }>(
    '/bank/movements/:id/confirm',
    {
      schema: {
        summary: 'Confirmar un movimiento como recurrente (HU36, HU01, HU02)',
        description: 'Un abono se agrega como ingreso y un cargo como gasto, todos los meses desde el mes del movimiento si no se indica otra periodicidad.',
        tags: TAGS,
        security,
        params: strict({ id }),
        body: strict({ label, schedule: scheduleSchema, nature: { type: 'string', enum: ['fixed', 'variable_estimate'] } }, ['label']),
        response: { 201: strict({ id }), ...refusals },
      },
    },
    async (request, reply) => {
      const { schedule, nature } = request.body;
      const result = await aggregation.confirmRecurring(await context(request), request.params.id, {
        label: request.body.label,
        ...(schedule === undefined ? {} : { schedule: scheduleFromJson(schedule) }),
        ...(nature === undefined ? {} : { nature }),
      });
      return result.ok ? reply.status(201).send({ id: result.id }) : refuse(reply, result);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/bank/accounts/:id/opening-balance',
    {
      schema: {
        summary: 'Usar el saldo disponible de una cuenta como saldo inicial (HU04, HU36)',
        tags: TAGS,
        security,
        params: strict({ id }),
        response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) =>
      (await aggregation.openingBalanceFromAccount(await context(request), request.params.id))
        ? reply.status(204).send()
        : reply.status(404).send({ error: 'not_found', message: 'Recurso no encontrado.' }),
  );

  done();
};
