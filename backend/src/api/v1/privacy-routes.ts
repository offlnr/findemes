import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import type { AccessTokenService } from '../../modules/identity/ports/identity-ports.ts';
import type { PrivacyService } from '../../modules/privacy/application/privacy-service.ts';
import type { ConsentKind } from '../../modules/privacy/ports/privacy-ports.ts';
import { noStore, requireActor } from './authenticate.ts';
import { badRequestSchema } from './common-schemas.ts';
import { label, strict } from './schedule-schema.ts';

export interface PrivacyRoutesOptions {
  readonly privacy: PrivacyService;
  readonly accessTokens: AccessTokenService;
}

const TAGS = ['privacidad'];
const security = [{ bearerAuth: [] }];
const errorSchema = strict({ error: { type: 'string' }, message: { type: 'string' } });
const kind = { type: 'string', enum: ['terms', 'privacy_policy', 'bank_connection'] } as const;
// Same names and path as the session routes, so erasing the account also clears them.
const SESSION_COOKIES = ['fdm_refresh', 'fdm_device'];

/** HU21 and HU32 (Ley 21.719). Each route touches only the actor's own data. */
export const privacyRoutes: FastifyPluginCallback<PrivacyRoutesOptions> = (app, options, done) => {
  const { privacy, accessTokens } = options;
  const context = async (request: FastifyRequest) => ({ actor: await requireActor(request, accessTokens), ip: request.ip });

  app.get(
    '/me/export',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        summary: 'Exportar mis datos personales (HU21)',
        description: 'Documento JSON con todo lo que la plataforma guarda de la cuenta: registro, escenarios, hogar, suscripción, consentimientos y datos bancarios.',
        tags: TAGS,
        security,
        response: { 200: { type: 'object', additionalProperties: true }, 401: errorSchema },
      },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      noStore(reply);
      void reply.header('content-disposition', 'attachment; filename="fin-de-mes-mis-datos.json"');
      return privacy.export(actor);
    },
  );

  app.patch<{ Body: { displayName: string } }>(
    '/me',
    {
      schema: {
        summary: 'Rectificar los datos de la cuenta (HU21)',
        description: 'Los datos financieros se rectifican en el registro; aquí, el alias de la cuenta.',
        tags: TAGS,
        security,
        body: strict({ displayName: label }),
        response: { 204: { type: 'null' }, 400: badRequestSchema, 401: errorSchema },
      },
    },
    async (request, reply) => {
      const result = await privacy.rectify(await context(request), request.body);
      if (!result.ok) return reply.status(400).send({ error: 'invalid_fields', message: result.message, issues: [{ field: result.field, message: result.message }] });
      return reply.status(204).send();
    },
  );

  app.delete<{ Body: { password: string } }>(
    '/me',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        summary: 'Eliminar mi cuenta con borrado efectivo (HU21)',
        description:
          'Exige la contraseña vigente. Borra la cuenta y todos sus datos individuales. Si administrabas un hogar, la administración pasa al integrante más antiguo.',
        tags: TAGS,
        security,
        body: strict({ password: { type: 'string', minLength: 1, maxLength: 256 } }),
        response: { 204: { type: 'null' }, 400: badRequestSchema, 401: errorSchema, 403: errorSchema },
      },
    },
    async (request, reply) => {
      const result = await privacy.erase(await context(request), request.body.password);
      if (result === 'invalid_password') return reply.status(403).send({ error: 'invalid_password', message: 'La contraseña no es correcta.' });
      for (const name of SESSION_COOKIES) void reply.clearCookie(name, { path: '/v1/auth' });
      return reply.status(204).send();
    },
  );

  const consentView = strict({
    kind,
    documentVersion: { type: 'string' },
    acceptedAt: { type: 'string', format: 'date-time' },
    withdrawnAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  });

  app.get(
    '/consents',
    {
      schema: {
        summary: 'Mis consentimientos y su historial (HU32)',
        tags: TAGS,
        security,
        response: { 200: strict({ consents: { type: 'array', items: consentView } }), 401: errorSchema },
      },
    },
    async (request, reply) => {
      const { actor } = await context(request);
      noStore(reply);
      const consents = await privacy.consents(actor);
      return {
        consents: consents.map((consent) => ({
          kind: consent.kind,
          documentVersion: consent.documentVersion,
          acceptedAt: consent.acceptedAt.toISOString(),
          withdrawnAt: consent.withdrawnAt?.toISOString() ?? null,
        })),
      };
    },
  );

  app.post<{ Body: { kind: ConsentKind } }>(
    '/consents',
    {
      schema: {
        summary: 'Aceptar la versión vigente de un documento (HU32)',
        tags: TAGS,
        security,
        body: strict({ kind }),
        response: { 201: strict({ kind, documentVersion: { type: 'string' } }), 400: badRequestSchema, 401: errorSchema },
      },
    },
    async (request, reply) => {
      const version = await privacy.accept(await context(request), request.body.kind);
      return reply.status(201).send({ kind: request.body.kind, documentVersion: version });
    },
  );

  app.delete<{ Params: { kind: ConsentKind } }>(
    '/consents/:kind',
    {
      schema: {
        summary: 'Retirar un consentimiento (HU32)',
        description: 'El historial se conserva; el retiro queda registrado con su fecha.',
        tags: TAGS,
        security,
        params: strict({ kind }),
        response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) =>
      (await privacy.withdraw(await context(request), request.params.kind))
        ? reply.status(204).send()
        : reply.status(404).send({ error: 'not_found', message: 'No hay un consentimiento vigente de ese tipo.' }),
  );

  done();
};
