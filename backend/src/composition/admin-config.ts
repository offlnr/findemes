import { z } from 'zod';

const EXACT_ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;
const key = (name: string, exact: boolean) =>
  z
    .string()
    .transform((value) => new Uint8Array(Buffer.from(value, 'base64url')))
    .refine((bytes) => (exact ? bytes.length === 32 : bytes.length >= 32), `${name} must decode to ${exact ? 'exactly' : 'at least'} 32 bytes (base64url)`);

const adminSchema = z.object({
  // Login role of the admin API (app_admin group): no grant on financial tables (HU23).
  ADMIN_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Its own signing secret: a token of the public API is never valid here.
  ADMIN_JWT_SECRET: key('ADMIN_JWT_SECRET', false),
  // AES-256-GCM key of the administrators' TOTP secrets.
  ADMIN_TOTP_KEY: key('ADMIN_TOTP_KEY', true),
  ADMIN_CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter((origin) => origin !== ''))
    .pipe(z.array(z.string().regex(EXACT_ORIGIN))),
  // HU24: the public API health check, reached from the admin network.
  PUBLIC_API_HEALTH_URL: z.url().optional(),
});

export interface AdminConfig {
  readonly databaseUrl: string;
  readonly jwtSecret: Uint8Array;
  readonly totpKey: Uint8Array;
  readonly corsOrigins: readonly string[];
  readonly publicApiHealthUrl: string | null;
}

/** Without ADMIN_DATABASE_URL the admin API serves only its health check. */
export function loadAdminConfig(env: NodeJS.ProcessEnv): AdminConfig | null {
  const pick = (name: string) => (env[name] === undefined || env[name] === '' ? undefined : env[name]);
  if (pick('ADMIN_DATABASE_URL') === undefined) return null;
  const parsed = adminSchema.safeParse({
    ADMIN_DATABASE_URL: pick('ADMIN_DATABASE_URL'),
    ADMIN_JWT_SECRET: pick('ADMIN_JWT_SECRET') ?? '',
    ADMIN_TOTP_KEY: pick('ADMIN_TOTP_KEY') ?? '',
    ADMIN_CORS_ORIGINS: pick('ADMIN_CORS_ORIGINS'),
    PUBLIC_API_HEALTH_URL: pick('PUBLIC_API_HEALTH_URL'),
  });
  if (!parsed.success) {
    const variables = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new Error(`Invalid admin configuration in environment variables: ${variables}`);
  }
  return {
    databaseUrl: parsed.data.ADMIN_DATABASE_URL,
    jwtSecret: parsed.data.ADMIN_JWT_SECRET,
    totpKey: parsed.data.ADMIN_TOTP_KEY,
    corsOrigins: parsed.data.ADMIN_CORS_ORIGINS,
    publicApiHealthUrl: parsed.data.PUBLIC_API_HEALTH_URL ?? null,
  };
}
