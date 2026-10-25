// Runs once before all database tests: migrates a template database and creates the login
// roles. Roles are cluster-wide, so doing this per test file would race between files.
import pg from 'pg';
import { ensureLoginRole, loadMigrations, migrate } from '../../src/adapters/postgres/migrator.ts';
import {
  TEMPLATE_DATABASE,
  TEST_ADMIN_ROLE,
  TEST_API_ROLE,
  TEST_DATABASE_PREFIX,
  TEST_ROLE_PASSWORD,
  ownerUrl,
} from './settings.ts';

async function withClient(url: URL, work: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

export async function setup(): Promise<() => Promise<void>> {
  const base = ownerUrl();
  await withClient(base, async (client) => {
    // Remove databases left behind by interrupted runs, then rebuild the template.
    const { rows } = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE $1`,
      [`${TEST_DATABASE_PREFIX}%`],
    );
    for (const { datname } of rows) {
      await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(datname)} WITH (FORCE)`);
    }
    await client.query(`CREATE DATABASE ${TEMPLATE_DATABASE}`);
  });

  const template = new URL(base);
  template.pathname = `/${TEMPLATE_DATABASE}`;
  await withClient(template, async (client) => {
    await migrate(client, await loadMigrations());
    await ensureLoginRole(client, TEST_API_ROLE, 'app_api', TEST_ROLE_PASSWORD);
    await ensureLoginRole(client, TEST_ADMIN_ROLE, 'app_admin', TEST_ROLE_PASSWORD);
  });

  return async () => {
    await withClient(base, async (client) => {
      await client.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DATABASE} WITH (FORCE)`);
    });
  };
}
