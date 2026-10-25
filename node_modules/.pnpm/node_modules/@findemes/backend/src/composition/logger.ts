import type { FastifyServerOptions } from 'fastify';
import type { ServiceConfig } from './config.ts';

/** Keys whose values never reach the logs (CLAUDE.md, Seguridad). */
const SENSITIVE_KEYS = ['password', 'token', 'accessToken', 'refreshToken', 'email', 'authorization', 'cookie'];

/**
 * pino redaction paths: each sensitive key at the top level and up to two levels deep, plus the
 * request headers in case a serializer starts logging them. Deeper objects must not be logged:
 * log identifiers, never whole domain objects.
 */
export const REDACTED_LOG_PATHS = [
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function loggerOptions(config: ServiceConfig): NonNullable<FastifyServerOptions['logger']> {
  return {
    level: config.logLevel,
    redact: { paths: REDACTED_LOG_PATHS, censor: '[redacted]' },
  };
}
