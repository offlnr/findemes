import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAdminApi } from './build-admin-api.ts';

describe('admin API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildAdminApi({ logger: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the health check', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('does not serve the public /v1 routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(response.statusCode).toBe(404);
  });
});
