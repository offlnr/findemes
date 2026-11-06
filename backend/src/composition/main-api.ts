// Entry point of the public API process.
import { buildPublicApi } from '../api/build-public-api.ts';
import { loadServiceConfig } from './config.ts';
import { loadIdentityConfig } from './identity-config.ts';
import { loggerOptions } from './logger.ts';
import { loadPaymentsConfig } from './payments-config.ts';
import { runService } from './run-service.ts';
import { systemClock } from './system-clock.ts';
import { wireServices } from './wire-services.ts';

const DEFAULT_PORT = 3000;

const config = loadServiceConfig(process.env, DEFAULT_PORT);
const identityConfig = loadIdentityConfig(process.env);
const services = identityConfig === null ? null : await wireServices(config, identityConfig, loadPaymentsConfig(process.env), systemClock);
const app = await buildPublicApi({
  logger: loggerOptions(config),
  clock: systemClock,
  corsOrigins: config.corsOrigins,
  ...(services === null ? {} : services.modules),
});
if (services !== null) {
  app.addHook('onClose', () => services.close());
}
await runService(app, config);
