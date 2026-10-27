import { randomBytes } from 'node:crypto';
import type { AuthRoutesOptions } from '../api/v1/auth-routes.ts';
import { loadBreachedPasswordList } from '../adapters/breached-passwords/breached-password-list.ts';
import { argon2PasswordHasher } from '../adapters/crypto/argon2-password-hasher.ts';
import { createAccessTokenService } from '../adapters/crypto/jose-access-tokens.ts';
import { createSecretTools } from '../adapters/crypto/node-secret-tools.ts';
import { createDevOutboxEmailSender } from '../adapters/email/dev-outbox-email-sender.ts';
import { createPgIdentityStores } from '../adapters/postgres/pg-identity-stores.ts';
import { createPgPool, createPgTransactionRunner } from '../adapters/postgres/pg-transaction-runner.ts';
import { IdentityService } from '../modules/identity/application/identity-service.ts';
import { SESSION_POLICY } from '../modules/identity/domain/session-policy.ts';
import type { EmailSender } from '../modules/notifications/ports/notification-ports.ts';
import type { Clock } from '../modules/shared/ports.ts';
import type { ServiceConfig } from './config.ts';
import type { IdentityConfig } from './identity-config.ts';

export const JWT_ISSUER = 'findemes-api';
export const JWT_AUDIENCE = 'findemes-app';

const DEV_OUTBOX = new URL('../../.outbox/', import.meta.url);

export interface WiredIdentity {
  readonly auth: AuthRoutesOptions;
  close(): Promise<void>;
}

/** Composition root of identity: connects its ports with the PostgreSQL and crypto adapters. */
export async function wireIdentity(service: ServiceConfig, config: IdentityConfig, clock: Clock): Promise<WiredIdentity> {
  let email: EmailSender;
  if (service.environment === 'development') {
    email = createDevOutboxEmailSender(DEV_OUTBOX);
  } else {
    // Amazon SES is the transactional provider (CLAUDE.md); until its adapter exists, identity
    // cannot run outside development rather than silently not sending emails.
    throw new Error('Identity needs the Amazon SES email adapter outside development');
  }

  const pool = createPgPool(config.databaseUrl);
  const runner = createPgTransactionRunner(pool);
  const stores = createPgIdentityStores(runner, config.hmacKey, clock);
  const accessTokens = createAccessTokenService({
    secret: config.jwtSecret,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    lifetimeMs: SESSION_POLICY.accessTokenMs,
    clock,
  });

  const identity = new IdentityService({
    ...stores,
    hasher: argon2PasswordHasher,
    breached: loadBreachedPasswordList(),
    accessTokens,
    secrets: createSecretTools(config.hmacKey),
    email,
    clock,
    appBaseUrl: config.appBaseUrl,
    // Verified when the email has no account, so both cases cost one argon2id verification.
    dummyPasswordHash: await argon2PasswordHasher.hash(randomBytes(32).toString('base64url')),
  });

  return {
    // Secure cookies also work on http://localhost: browsers treat it as a secure context.
    auth: { identity, accessTokens, accounts: stores.accounts, secureCookies: true },
    close: () => pool.end(),
  };
}
