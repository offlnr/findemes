import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerErrorHandling } from '../http/error-handling.ts';
import type { AdminService } from '../modules/administration/application/admin-service.ts';
import { adminRoutes } from './admin-routes.ts';

export interface AdminApiOptions {
  readonly logger: NonNullable<FastifyServerOptions['logger']>;
  /** Absent: only the health check (e.g. without a database). */
  readonly admin?: AdminService;
  /** Exact origin of the admin panel (Flutter web), reachable only through Tailscale. */
  readonly corsOrigins?: readonly string[];
  /** Interactive documentation at /docs (development and integration only). */
  readonly docs?: boolean;
}

const BODY_LIMIT_BYTES = 64 * 1024;

/**
 * Builds the administration API. Separate process and deployment (rule 9): it runs on its own EC2 instance
 * reachable only through Tailscale (RNF21) and its database role cannot read financial tables (HU23).
 */
export async function buildAdminApi(options: AdminApiOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger,
    bodyLimit: BODY_LIMIT_BYTES,
    // Strict validation, as in the public API: unknown fields are rejected and types are not coerced.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Fin de Mes — API de administración', description: 'Solo en la red de administración (Tailscale). Segundo factor TOTP.', version: '1.0.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    },
  });
  if (options.docs === true) {
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  registerErrorHandling(app);
  await app.register(cors, { origin: [...(options.corsOrigins ?? [])], methods: ['GET', 'POST'] });
  await app.register(rateLimit, { global: false });

  app.get('/health', () => ({ status: 'ok' as const }));

  if (options.admin !== undefined) {
    await app.register(adminRoutes, { prefix: '/admin/v1', admin: options.admin });
  }

  return app;
}
