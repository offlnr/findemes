import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerErrorHandling } from '../http/error-handling.ts';
import { v1Routes } from './v1/routes.ts';

export interface PublicApiOptions {
  readonly logger: NonNullable<FastifyServerOptions['logger']>;
}

/** Requests in this API are small JSON documents. */
const BODY_LIMIT_BYTES = 64 * 1024;

const OPENAPI_INFO = {
  title: 'Fin de Mes — API pública',
  description:
    'API REST versionada de Fin de Mes. Las rutas administrativas no forman parte de esta API.',
  version: '1.0.0',
};

/** Builds the public REST API. Contains no administrative route (rule 9). */
export async function buildPublicApi(options: PublicApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger, bodyLimit: BODY_LIMIT_BYTES });

  await app.register(swagger, { openapi: { openapi: '3.1.0', info: OPENAPI_INFO } });

  registerErrorHandling(app);

  app.get(
    '/health',
    {
      schema: {
        summary: 'Estado del servicio',
        tags: ['infraestructura'],
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string', enum: ['ok'] } },
            required: ['status'],
            additionalProperties: false,
          },
        },
      },
    },
    () => ({ status: 'ok' as const }),
  );

  await app.register(v1Routes, { prefix: '/v1' });

  return app;
}
