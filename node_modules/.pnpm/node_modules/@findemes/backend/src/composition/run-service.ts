import type { FastifyInstance } from 'fastify';
import type { ServiceConfig } from './config.ts';

/** Forced exit if in-flight requests do not finish within this time after a stop signal. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Starts a service and closes it gracefully on SIGTERM/SIGINT (stateless containers). */
export async function runService(app: FastifyInstance, config: ServiceConfig): Promise<void> {
  const shutdown = (signal: NodeJS.Signals): void => {
    app.log.info({ signal }, 'shutting down');
    setTimeout(() => {
      app.log.error('shutdown timed out');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'error while shutting down');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await app.listen({ host: config.host, port: config.port });
}
