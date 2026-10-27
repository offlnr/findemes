import type { FastifyPluginAsync } from 'fastify';
import type { Clock } from '../../modules/shared/ports.ts';
import { demoRoutes } from './demo-routes.ts';

export interface V1RoutesOptions {
  readonly clock: Clock;
}

/**
 * Versioned public routes, mounted under /v1. Each module adds its routes here with a full
 * request/response schema, which is what keeps docs/openapi.yaml up to date.
 */
export const v1Routes: FastifyPluginAsync<V1RoutesOptions> = async (app, options) => {
  await app.register(demoRoutes, { clock: options.clock });
};
