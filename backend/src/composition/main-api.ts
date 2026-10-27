// Entry point of the public API process.
import { buildPublicApi } from '../api/build-public-api.ts';
import { loadServiceConfig } from './config.ts';
import { loggerOptions } from './logger.ts';
import { runService } from './run-service.ts';
import { systemClock } from './system-clock.ts';

const DEFAULT_PORT = 3000;

const config = loadServiceConfig(process.env, DEFAULT_PORT);
const app = await buildPublicApi({ logger: loggerOptions(config), clock: systemClock });
await runService(app, config);
