import type { FastifyPluginAsync } from 'fastify';
import type { Clock } from '../../modules/shared/ports.ts';
import { authRoutes, type AuthRoutesOptions } from './auth-routes.ts';
import { demoRoutes } from './demo-routes.ts';
import { registryRoutes } from './registry-routes.ts';
import type { RegistryService } from '../../modules/registry/application/registry-service.ts';

export interface V1RoutesOptions {
  readonly clock: Clock;
  /** Identity and session routes; absent until their database adapters are wired. */
  readonly auth?: AuthRoutesOptions;
  /** Registry and projection routes; they need identity for the session. */
  readonly registry?: RegistryService;
}

/**
 * Versioned public routes, mounted under /v1. Each module adds its routes here with a full
 * request/response schema, which is what keeps docs/openapi.yaml up to date.
 */
export const v1Routes: FastifyPluginAsync<V1RoutesOptions> = async (app, options) => {
  await app.register(demoRoutes, { clock: options.clock });
  if (options.auth !== undefined) {
    await app.register(authRoutes, options.auth);
    if (options.registry !== undefined) {
      await app.register(registryRoutes, { registry: options.registry, accessTokens: options.auth.accessTokens, clock: options.clock });
    }
  }
};
