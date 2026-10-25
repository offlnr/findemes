import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const serviceConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Loopback by default; containers set HOST=0.0.0.0 explicitly.
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export interface ServiceConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: (typeof LOG_LEVELS)[number];
}

/**
 * Reads a service configuration from environment variables and fails fast when it is invalid.
 * Error messages name the variable but never echo its value.
 */
export function loadServiceConfig(env: NodeJS.ProcessEnv, defaultPort: number): ServiceConfig {
  const parsed = serviceConfigSchema.safeParse({ PORT: defaultPort, ...pickDefined(env) });
  if (!parsed.success) {
    const variables = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid configuration in environment variables: ${variables}`);
  }
  return {
    environment: parsed.data.NODE_ENV,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
  };
}

function pickDefined(env: NodeJS.ProcessEnv): Record<string, string> {
  const keys = ['NODE_ENV', 'HOST', 'PORT', 'LOG_LEVEL'] as const;
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined && value !== '') {
      result[key] = value;
    }
  }
  return result;
}
