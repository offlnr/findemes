import type { FastifyPluginAsync } from 'fastify';

/**
 * Versioned public routes, mounted under /v1. Each module adds its routes here with a full
 * request/response schema, which is what keeps docs/openapi.yaml up to date.
 */
export const v1Routes: FastifyPluginAsync = async () => {
  // Routes are added module by module (registry, scenarios, demo, ...).
};
