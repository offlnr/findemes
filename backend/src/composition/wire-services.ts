import { randomBytes, randomUUID } from 'node:crypto';
import { createWebpayPlusGateway } from '../adapters/webpay/webpay-plus-gateway.ts';
import { createPgSubscriptionStore } from '../adapters/postgres/pg-subscription-store.ts';
import { SubscriptionService } from '../modules/subscription/application/subscription-service.ts';
import type { PaymentsConfig } from './payments-config.ts';
import { createPgPrivacyStore } from '../adapters/postgres/pg-privacy-store.ts';
import { PrivacyService } from '../modules/privacy/application/privacy-service.ts';
import { createAesGcmTokenCipher } from '../adapters/crypto/aes-gcm-token-cipher.ts';
import { createDemoBankAggregator, demoLinkToken } from '../adapters/demo-bank/demo-bank.ts';
import { DEMO_PROFILES } from '../adapters/demo-bank/profiles.ts';
import { createFintocClient } from '../adapters/fintoc/fintoc-client.ts';
import { createPgBankStore } from '../adapters/postgres/pg-bank-store.ts';
import { AggregationService } from '../modules/aggregation/application/aggregation-service.ts';
import type { BankConfig } from './bank-config.ts';
import type { AuthRoutesOptions } from '../api/v1/auth-routes.ts';
import { loadBreachedPasswordList } from '../adapters/breached-passwords/breached-password-list.ts';
import { argon2PasswordHasher } from '../adapters/crypto/argon2-password-hasher.ts';
import { createAccessTokenService } from '../adapters/crypto/jose-access-tokens.ts';
import { createSecretTools } from '../adapters/crypto/node-secret-tools.ts';
import { createDevOutboxEmailSender } from '../adapters/email/dev-outbox-email-sender.ts';
import { createSmtpEmailSender } from '../adapters/email/smtp-email-sender.ts';
import type { EmailConfig } from './email-config.ts';
import { createPgHouseholdStore } from '../adapters/postgres/pg-household-store.ts';
import { createPgIdentityStores } from '../adapters/postgres/pg-identity-stores.ts';
import { createPgRegistryStore } from '../adapters/postgres/pg-registry-store.ts';
import { createPgPlanReader, createPgScenarioStore } from '../adapters/postgres/pg-scenario-store.ts';
import { createPgPool, createPgTransactionRunner } from '../adapters/postgres/pg-transaction-runner.ts';
import { HouseholdService } from '../modules/household/application/household-service.ts';
import { IdentityService } from '../modules/identity/application/identity-service.ts';
import { RegistryService } from '../modules/registry/application/registry-service.ts';
import { ScenarioService } from '../modules/scenarios/application/scenario-service.ts';
import { SESSION_POLICY } from '../modules/identity/domain/session-policy.ts';
import type { EmailSender } from '../modules/notifications/ports/notification-ports.ts';
import type { Clock } from '../modules/shared/ports.ts';
import type { IdentityConfig } from './identity-config.ts';

export const JWT_ISSUER = 'findemes-api';
export const JWT_AUDIENCE = 'findemes-app';

const DEV_OUTBOX = new URL('../../.outbox/', import.meta.url);

export interface WiredServices {
  /** Everything the public API mounts under /v1. */
  readonly modules: {
    readonly auth: AuthRoutesOptions;
    readonly registry: RegistryService;
    readonly scenarios: ScenarioService;
    readonly households: HouseholdService;
    readonly subscriptions: { readonly service: SubscriptionService; readonly appBaseUrl: string };
    readonly privacy: PrivacyService;
    readonly aggregation: AggregationService;
  };
  close(): Promise<void>;
}

/** Composition root of the database-backed modules: connects their ports with the adapters. */
export async function wireServices(
  config: IdentityConfig,
  payments: PaymentsConfig,
  bank: BankConfig,
  emailConfig: EmailConfig,
  clock: Clock,
): Promise<WiredServices> {
  const email: EmailSender =
    emailConfig.transport === 'outbox' ? createDevOutboxEmailSender(DEV_OUTBOX) : createSmtpEmailSender(emailConfig.smtp);

  const pool = createPgPool(config.databaseUrl);
  const runner = createPgTransactionRunner(pool);
  const stores = createPgIdentityStores(runner, config.hmacKey, clock);
  const registryStore = createPgRegistryStore(runner);
  const ids = { newId: () => randomUUID() };
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

  const secrets = createSecretTools(config.hmacKey);
  const plans = createPgPlanReader(runner);
  const households = new HouseholdService({ households: createPgHouseholdStore(runner), plans, secrets, ids, clock, appBaseUrl: config.appBaseUrl });

  const subscriptionStore = createPgSubscriptionStore(runner);
  const subscriptions = new SubscriptionService({
    store: subscriptionStore,
    settlement: subscriptionStore,
    canceller: subscriptionStore,
    gateway: createWebpayPlusGateway(payments.webpay),
    plans,
    clock,
    randomHex: () => randomBytes(16).toString('hex'),
    apiPublicUrl: payments.apiPublicUrl,
  });

  const privacyStore = createPgPrivacyStore(runner);
  const fintoc = bank.fintoc === null ? null : createFintocClient(bank.fintoc);
  const aggregation = new AggregationService({
    store: createPgBankStore(runner),
    ...(fintoc === null ? {} : { fintoc: { links: fintoc, aggregator: fintoc } }),
    demo: { aggregator: createDemoBankAggregator(clock), profiles: DEMO_PROFILES.map(({ id, label }) => ({ id, label })), linkTokenOf: demoLinkToken },
    cipher: createAesGcmTokenCipher(new Map([[1, bank.tokenKey]]), 1),
    hasBankConsent: async (actor) => (await privacyStore.listForActor(actor)).some((consent) => consent.kind === 'bank_connection' && consent.withdrawnAt === null),
    clock,
    ids,
  });

  return {
    modules: {
      // Secure cookies also work on http://localhost: browsers treat it as a secure context.
      auth: { identity, accessTokens, accounts: stores.accounts, secureCookies: true },
      // HU15: the household contribution enters the projection and the scenarios.
      registry: new RegistryService(registryStore, ids, households),
      scenarios: new ScenarioService({ scenarios: createPgScenarioStore(runner), registry: registryStore, plans, ids, commitments: households }),
      households,
      subscriptions: { service: subscriptions, appBaseUrl: config.appBaseUrl },
      aggregation,
      privacy: new PrivacyService({ data: privacyStore, consents: privacyStore, hasher: argon2PasswordHasher, passwordHashOf: (actor) => stores.accounts.passwordHash(actor),
        beforeErase: (actor) => aggregation.revokeAllAtProvider(actor),
      }),
    },
    close: () => pool.end(),
  };
}
