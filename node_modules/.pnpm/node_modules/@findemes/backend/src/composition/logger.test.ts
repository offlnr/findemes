import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { loggerOptions } from './logger.ts';

function captureLogs(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  return { stream, lines };
}

describe('loggerOptions', () => {
  it('redacts sensitive keys at the top level and nested up to two levels', async () => {
    const { stream, lines } = captureLogs();
    const options = loggerOptions({ environment: 'test', host: '127.0.0.1', port: 0, logLevel: 'info' });
    const app = Fastify({ logger: { ...(options as object), stream } });

    app.log.info({ email: 'ana@example.cl', password: 'hunter2' }, 'top level');
    app.log.info({ user: { email: 'ana@example.cl', token: 'tok-123' } }, 'one level');
    app.log.info({ user: { profile: { email: 'ana@example.cl', refreshToken: 'rt-456' } } }, 'two levels');
    await app.close();

    const output = lines.join('');
    expect(output).toContain('top level');
    expect(output).toContain('two levels');
    for (const secret of ['ana@example.cl', 'hunter2', 'tok-123', 'rt-456']) {
      expect(output).not.toContain(secret);
    }
  });
});
