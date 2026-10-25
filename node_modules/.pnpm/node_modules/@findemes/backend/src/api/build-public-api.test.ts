import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPublicApi } from './build-public-api.ts';

describe('public API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildPublicApi({ logger: false });
    app.get('/boom-test-only', () => {
      throw new Error('database password is hunter2');
    });
    app.post('/echo-test-only', () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the health check', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('exposes no administrative route (rule 9)', () => {
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).not.toMatch(/admin/i);
  });

  it('documents no administrative path in its OpenAPI contract (rule 9)', () => {
    const paths = Object.keys(app.swagger().paths ?? {});
    expect(paths.some((path) => /admin/i.test(path))).toBe(false);
  });

  it('answers 404 for unknown routes with the uniform error shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found', message: 'Recurso no encontrado.' });
  });

  it('hides internal error details from the client', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom-test-only' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('hunter2');
    expect(response.json()).toEqual({
      error: 'internal_error',
      message: 'Ocurrió un error inesperado.',
    });
  });

  it('rejects request bodies above 64 KiB', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/echo-test-only',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
    });
    expect(response.statusCode).toBe(413);
  });
});
