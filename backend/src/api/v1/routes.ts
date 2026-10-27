import type { FastifyPluginAsync } from 'fastify';
import type { Clock } from '../../modules/shared/ports.ts';
import { authRoutes, type AuthRoutesOptions } from './auth-routes.ts';
import { demoRoutes } from './demo-routes.ts';

export interface V1RoutesOptions {
  readonly clock: Clock;
  /** Identity and session routes; absent until their database adapters are wired. */
  readonly auth?: AuthRoutesOptions;
}

/**
 * Versioned public routes, mounted under /v1. Each module adds its routes here with a full
 * request/response schema, which is what keeps docs/openapi.yaml up to date.
 */
export const v1Routes: FastifyPluginAsync<V1RoutesOptions> = async (app, options) => {
  await app.register(demoRoutes, { clock: options.clock });
  if (options.auth !== undefined) {
    await app.register(authRoutes, options.auth);
  }
};
