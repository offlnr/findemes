// Entry point of the administration API process (separate deployment, rule 9).
import { randomBytes } from 'node:crypto';
import { buildAdminApi } from '../admin-api/build-admin-api.ts';
import { createAesGcmTokenCipher } from '../adapters/crypto/aes-gcm-token-cipher.ts';
import { argon2PasswordHasher } from '../adapters/crypto/argon2-password-hasher.ts';
import { createAccessTokenService } from '../adapters/crypto/jose-access-tokens.ts';
import { verifyTotp } from '../adapters/crypto/totp.ts';
import { createPgAdminDirectory } from '../adapters/postgres/pg-admin-directory.ts';
import { createPgPool, createPgTransactionRunner } from '../adapters/postgres/pg-transaction-runner.ts';
import { createWebpayStatusSource } from '../adapters/webpay/webpay-plus-gateway.ts';
import { AdminService } from '../modules/administration/application/admin-service.ts';
import { loadAdminConfig } from './admin-config.ts';
import { loadServiceConfig } from './config.ts';
import { loggerOptions } from './logger.ts';
import { loadPaymentsConfig } from './payments-config.ts';
import { runService } from './run-service.ts';
import { systemClock } from './system-clock.ts';

const DEFAULT_PORT = 3001;
/** Admin sessions are short: 15 minutes, like the public access token. */
const ADMIN_TOKEN_MS = 15 * 60_000;

const config = loadServiceConfig(process.env, DEFAULT_PORT);
const adminConfig = loadAdminConfig(process.env);

let admin: AdminService | undefined;
let close: (() => Promise<void>) | undefined;
if (adminConfig !== null) {
  const pool = createPgPool(adminConfig.databaseUrl);
  close = () => pool.end();
  const totpCipher = createAesGcmTokenCipher(new Map([[1, adminConfig.totpKey]]), 1);
  const healthUrl = adminConfig.publicApiHealthUrl;
  admin = new AdminService({
    directory: createPgAdminDirectory(createPgTransactionRunner(pool)),
    hasher: argon2PasswordHasher,
    openTotpSecret: (sealed) => totpCipher.decrypt(sealed),
    verifyTotp,
    tokens: createAccessTokenService({ secret: adminConfig.jwtSecret, issuer: 'findemes-admin-api', audience: 'findemes-admin', lifetimeMs: ADMIN_TOKEN_MS, clock: systemClock }),
    clock: systemClock,
    payments: createWebpayStatusSource(loadPaymentsConfig(process.env).webpay),
    dummyPasswordHash: await argon2PasswordHasher.hash(randomBytes(32).toString('base64url')),
    ...(healthUrl === null
      ? {}
      : {
          checkPublicApi: async () => {
            const started = performance.now();
            try {
              const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
              return { up: response.ok, latencyMs: Math.round(performance.now() - started) };
            } catch {
              return { up: false, latencyMs: null };
            }
          },
        }),
  });
}

const app = await buildAdminApi({
  logger: loggerOptions(config),
  ...(admin === undefined ? {} : { admin }),
  corsOrigins: adminConfig?.corsOrigins ?? [],
  docs: config.environment !== 'production',
});
if (close !== undefined) app.addHook('onClose', close);
await runService(app, config);
