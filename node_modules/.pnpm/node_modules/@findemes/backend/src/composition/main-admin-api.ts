// Entry point of the administration API process (separate deployment, rule 9).
import { buildAdminApi } from '../admin-api/build-admin-api.ts';
import { loadServiceConfig } from './config.ts';
import { loggerOptions } from './logger.ts';
import { runService } from './run-service.ts';

const DEFAULT_PORT = 3001;

const config = loadServiceConfig(process.env, DEFAULT_PORT);
const app = await buildAdminApi({ logger: loggerOptions(config) });
await runService(app, config);
