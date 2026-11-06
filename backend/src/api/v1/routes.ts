import type { FastifyPluginAsync } from 'fastify';
import type { Clock } from '../../modules/shared/ports.ts';
import { authRoutes, type AuthRoutesOptions } from './auth-routes.ts';
import { demoRoutes } from './demo-routes.ts';
import { registryRoutes } from './registry-routes.ts';
import { scenarioRoutes } from './scenario-routes.ts';
import type { ScenarioService } from '../../modules/scenarios/application/scenario-service.ts';
import type { RegistryService } from '../../modules/registry/application/registry-service.ts';
import type { HouseholdService } from '../../modules/household/application/household-service.ts';
import { householdRoutes } from './household-routes.ts';
import type { SubscriptionService } from '../../modules/subscription/application/subscription-service.ts';
import { subscriptionRoutes } from './subscription-routes.ts';

export interface V1RoutesOptions {
  readonly clock: Clock;
  /** Identity and session routes; absent until their database adapters are wired. */
  readonly auth?: AuthRoutesOptions;
  /** Registry and projection routes; they need identity for the session. */
  readonly registry?: RegistryService;
  readonly scenarios?: ScenarioService;
  readonly households?: HouseholdService;
  /** Plans and Webpay payments; appBaseUrl is where the payment result screen lives. */
  readonly subscriptions?: { readonly service: SubscriptionService; readonly appBaseUrl: string };
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
    if (options.scenarios !== undefined) {
      await app.register(scenarioRoutes, { scenarios: options.scenarios, accessTokens: options.auth.accessTokens });
    }
    if (options.subscriptions !== undefined) {
      await app.register(subscriptionRoutes, {
        subscriptions: options.subscriptions.service,
        appBaseUrl: options.subscriptions.appBaseUrl,
        accessTokens: options.auth.accessTokens,
      });
    }
    if (options.households !== undefined) {
      await app.register(householdRoutes, { households: options.households, accessTokens: options.auth.accessTokens });
    }
  }
};
