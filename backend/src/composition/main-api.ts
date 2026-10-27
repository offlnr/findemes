// Entry point of the public API process.
import { buildPublicApi } from '../api/build-public-api.ts';
import { loadServiceConfig } from './config.ts';
import { loadIdentityConfig } from './identity-config.ts';
import { loggerOptions } from './logger.ts';
import { runService } from './run-service.ts';
import { systemClock } from './system-clock.ts';
import { wireIdentity } from './wire-identity.ts';

const DEFAULT_PORT = 3000;

const config = loadServiceConfig(process.env, DEFAULT_PORT);
const identityConfig = loadIdentityConfig(process.env);
const identity = identityConfig === null ? null : await wireIdentity(config, identityConfig, systemClock);
const app = await buildPublicApi({
  logger: loggerOptions(config),
  clock: systemClock,
  corsOrigins: config.corsOrigins,
  ...(identity === null ? {} : { auth: identity.auth }),
});
if (identity !== null) {
  app.addHook('onClose', () => identity.close());
}
await runService(app, config);
