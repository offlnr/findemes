import { z } from 'zod';

const bankSchema = z.object({
  // AES-256-GCM key for link tokens: 32 random bytes in base64url.
  BANK_TOKEN_KEY: z
    .string()
    .transform((value) => new Uint8Array(Buffer.from(value, 'base64url')))
    .refine((bytes) => bytes.length === 32, 'BANK_TOKEN_KEY must decode to 32 bytes (base64url)'),
  // Fintoc test mode only (ADR-002): live keys need a commercial agreement and Ley 21.719 consent.
  FINTOC_SECRET_KEY: z.string().regex(/^sk_test_[A-Za-z0-9_-]{8,}$/).optional(),
  FINTOC_PUBLIC_KEY: z.string().regex(/^pk_test_[A-Za-z0-9_-]{8,}$/).optional(),
});

export interface BankConfig {
  readonly tokenKey: Uint8Array;
  readonly fintoc: { readonly secretKey: string; readonly publicKey: string } | null;
}

/**
 * Bank aggregation settings. The demo bank always works; Fintoc is offered only when both test
 * keys are set. Errors name the variable but never echo its value.
 */
export function loadBankConfig(env: NodeJS.ProcessEnv): BankConfig {
  const pick = (key: string) => (env[key] === undefined || env[key] === '' ? undefined : env[key]);
  const parsed = bankSchema.safeParse({
    BANK_TOKEN_KEY: pick('BANK_TOKEN_KEY') ?? '',
    FINTOC_SECRET_KEY: pick('FINTOC_SECRET_KEY'),
    FINTOC_PUBLIC_KEY: pick('FINTOC_PUBLIC_KEY'),
  });
  if (!parsed.success) {
    const variables = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new Error(`Invalid bank configuration in environment variables: ${variables}`);
  }
  const { FINTOC_SECRET_KEY: secretKey, FINTOC_PUBLIC_KEY: publicKey } = parsed.data;
  if ((secretKey === undefined) !== (publicKey === undefined)) {
    throw new Error('Invalid bank configuration in environment variables: FINTOC_SECRET_KEY, FINTOC_PUBLIC_KEY');
  }
  return {
    tokenKey: parsed.data.BANK_TOKEN_KEY,
    fintoc: secretKey === undefined || publicKey === undefined ? null : { secretKey, publicKey },
  };
}
