import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerErrorHandling } from '../http/error-handling.ts';

export interface AdminApiOptions {
  readonly logger: NonNullable<FastifyServerOptions['logger']>;
}

const BODY_LIMIT_BYTES = 64 * 1024;

/**
 * Builds the administration API. Separate process and deployment (rule 9): it runs on a Droplet
 * reachable only through Tailscale (RNF21) and its database role cannot read financial tables (HU23).
 */
export async function buildAdminApi(options: AdminApiOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger, bodyLimit: BODY_LIMIT_BYTES });

  registerErrorHandling(app);

  app.get('/health', () => ({ status: 'ok' as const }));

  return app;
}
