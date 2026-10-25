import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PublicError, registerErrorHandling } from './error-handling.ts';

describe('registerErrorHandling', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false, bodyLimit: 1024 });
    registerErrorHandling(app);
    app.get('/crash', () => {
      throw new Error('database password is hunter2');
    });
    app.get('/conflict', () => {
      throw Object.assign(new Error('duplicate key email=ana@example.cl'), { statusCode: 409 });
    });
    app.get('/weird-status', () => {
      throw Object.assign(new Error('weird'), { statusCode: 302 });
    });
    app.get('/public', () => {
      throw new PublicError(422, 'scenario_limit_reached', 'El plan actual permite 2 escenarios.');
    });
    app.post(
      '/validated',
      {
        schema: {
          body: {
            type: 'object',
            properties: { amount: { type: 'integer', minimum: 1 } },
            required: ['amount'],
            additionalProperties: false,
          },
        },
      },
      () => ({ ok: true }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('hides internal error details behind a generic 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/crash' });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('hunter2');
    expect(response.json()).toEqual({ error: 'internal_error', message: 'Ocurrió un error inesperado.' });
  });

  it('does not echo the message of a non-public 4xx error', async () => {
    const response = await app.inject({ method: 'GET', url: '/conflict' });
    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain('ana@example.cl');
    expect(response.json()).toEqual({ error: 'conflict', message: 'No se puede completar la solicitud.' });
  });

  it('turns statuses outside 400-599 into a 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/weird-status' });
    expect(response.statusCode).toBe(500);
  });

  it('shows the message of an explicit PublicError', async () => {
    const response = await app.inject({ method: 'GET', url: '/public' });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: 'scenario_limit_reached',
      message: 'El plan actual permite 2 escenarios.',
    });
  });

  it('reports validation errors by field without echoing values', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/validated',
      payload: { amount: -5, secret: 'hunter2' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('hunter2');
    expect(response.body).not.toContain('-5');
    expect(response.json()).toMatchObject({ error: 'validation_error', message: 'La solicitud no es válida.' });
  });

  it('rejects malformed JSON without echoing it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/validated',
      headers: { 'content-type': 'application/json' },
      payload: '{"amount": hunter2',
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('hunter2');
  });

  it('rejects bodies above the limit with 413', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/validated',
      payload: { amount: 1, padding: 'x'.repeat(2048) },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ error: 'payload_too_large' });
  });

  it('answers unknown routes with the same shape and without echoing the URL', async () => {
    const response = await app.inject({ method: 'GET', url: '/secret-path-hunter2' });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('hunter2');
    expect(response.json()).toEqual({ error: 'not_found', message: 'Recurso no encontrado.' });
  });
});
