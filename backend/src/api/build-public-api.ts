import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerErrorHandling } from '../http/error-handling.ts';
import type { Clock } from '../modules/shared/ports.ts';
import type { AuthRoutesOptions } from './v1/auth-routes.ts';
import { v1Routes } from './v1/routes.ts';

export interface PublicApiOptions {
  readonly logger: NonNullable<FastifyServerOptions['logger']>;
  readonly clock: Clock;
  /** Exact browser origins of the web app; empty means no cross-origin access. */
  readonly corsOrigins?: readonly string[];
  readonly auth?: AuthRoutesOptions;
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
  const app = Fastify({
    logger: options.logger,
    bodyLimit: BODY_LIMIT_BYTES,
    // Strict validation: unknown fields are rejected (not silently removed) and types are not coerced.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: OPENAPI_INFO,
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    },
  });

  registerErrorHandling(app);
  await app.register(cookie);
  await app.register(cors, {
    origin: [...(options.corsOrigins ?? [])],
    // The web refresh token travels in an HttpOnly cookie (CLAUDE.md, Sesiones).
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  // Limits apply only to routes that opt in through `config.rateLimit` (e.g. the public demo).
  await app.register(rateLimit, { global: false });

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

  await app.register(v1Routes, { prefix: '/v1', clock: options.clock, ...(options.auth === undefined ? {} : { auth: options.auth }) });

  return app;
}
