import { z } from 'zod';

const secret = (name: string) =>
  z
    .string()
    .transform((value) => new Uint8Array(Buffer.from(value, 'base64url')))
    .refine((bytes) => bytes.length >= 32, `${name} must decode to at least 32 bytes (base64url)`);

const identityConfigSchema = z.object({
  // Connection of the API login role (app_api group); never the owner role.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  JWT_SECRET: secret('JWT_SECRET'),
  // Keys the sign-in code digests and the login throttle keys.
  IDENTITY_HMAC_KEY: secret('IDENTITY_HMAC_KEY'),
  // Public URL of the web app, used in email links.
  APP_BASE_URL: z
    .string()
    .regex(/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/)
    .default('http://localhost:8080'),
});

export interface IdentityConfig {
  readonly databaseUrl: string;
  readonly jwtSecret: Uint8Array;
  readonly hmacKey: Uint8Array;
  readonly appBaseUrl: string;
}

/**
 * Identity needs the database; without DATABASE_URL the API runs without its routes (for example
 * the demo mode alone). When DATABASE_URL is set, every other variable must be valid. Errors name
 * the variable but never echo its value.
 */
export function loadIdentityConfig(env: NodeJS.ProcessEnv): IdentityConfig | null {
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    return null;
  }
  const parsed = identityConfigSchema.safeParse({
    DATABASE_URL: env['DATABASE_URL'],
    JWT_SECRET: env['JWT_SECRET'] ?? '',
    IDENTITY_HMAC_KEY: env['IDENTITY_HMAC_KEY'] ?? '',
    APP_BASE_URL: env['APP_BASE_URL'] === '' ? undefined : env['APP_BASE_URL'],
  });
  if (!parsed.success) {
    const variables = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new Error(`Invalid identity configuration in environment variables: ${variables}`);
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL,
    jwtSecret: parsed.data.JWT_SECRET,
    hmacKey: parsed.data.IDENTITY_HMAC_KEY,
    appBaseUrl: parsed.data.APP_BASE_URL,
  };
}
