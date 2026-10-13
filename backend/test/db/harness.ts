// Integration-test harness: one throwaway database per test file, cloned from a migrated template.
// Services connect with the real login roles (app_api / app_admin groups), so every test runs
// under the same Row-Level Security and grants as production.
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { TEMPLATE_DATABASE, TEST_ADMIN_ROLE, TEST_API_ROLE, TEST_ROLE_PASSWORD, ownerUrl } from './settings.ts';

export interface TestDatabase {
  /** Owner connection: fixtures and tampering checks only. Bypasses RLS like the migrator. */
  readonly owner: pg.Pool;
  /** Public API role. */
  readonly api: pg.Pool;
  /** Admin API role. */
  readonly admin: pg.Pool;
  readonly name: string;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const base = ownerUrl();
  const name = `findemes_test_${randomBytes(6).toString('hex')}`;

  // Cloned from the template migrated once by global-setup.ts.
  const maintenance = new pg.Client({ connectionString: base.toString() });
  await maintenance.connect();
  try {
    await maintenance.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE}`);
  } finally {
    await maintenance.end();
  }

  const ownerConnection = new URL(base);
  ownerConnection.pathname = `/${name}`;

  const asRole = (role: string): pg.Pool => {
    const url = new URL(ownerConnection);
    url.username = role;
    url.password = TEST_ROLE_PASSWORD;
    return new pg.Pool({ connectionString: url.toString(), max: 4 });
  };

  const owner = new pg.Pool({ connectionString: ownerConnection.toString(), max: 2 });
  const api = asRole(TEST_API_ROLE);
  const admin = asRole(TEST_ADMIN_ROLE);

  return {
    owner,
    api,
    admin,
    name,
    async drop() {
      await Promise.all([owner.end(), api.end(), admin.end()]);
      const cleanup = new pg.Client({ connectionString: base.toString() });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/**
 * Runs `work` in a transaction as the given user, the way repositories will: the user id is set
 * with set_config(..., true) so it never leaks to the next transaction on a pooled connection.
 * Rolls back on error and rethrows.
 */
export async function asUser<T>(pool: pg.Pool, userId: string | null, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId !== null) {
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    }
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Creates a user directly as the owner (fixture). Returns its id. */
export async function createUser(db: TestDatabase, email = `${randomUUID()}@example.cl`): Promise<string> {
  const { rows } = await db.owner.query<{ id: string }>(
    `INSERT INTO app.users (email, password_hash) VALUES ($1, '$argon2id$v=19$m=19456,t=2,p=1$fixture') RETURNING id`,
    [email],
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('fixture user was not created');
  }
  return id;
}

/** Postgres error code of a rejected promise (e.g. 42501 insufficient_privilege). */
export async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  throw new Error('expected the query to fail');
}
