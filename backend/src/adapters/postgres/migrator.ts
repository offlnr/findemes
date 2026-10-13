import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg, { type ClientBase } from 'pg';

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
/** Serializes concurrent runs (e.g. two deploy jobs at once). Session-level: needs a direct connection, not a pooler. */
const LOCK_KEY = 4_627_302_919;

export const MIGRATIONS_DIR = new URL('../../../migrations/', import.meta.url);

/** Reads `NNNN_name.sql` files in version order. Line endings are normalized before hashing. */
export async function loadMigrations(directory: URL = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new Error(`Migration file name must look like 0001_name.sql: ${file}`);
    }
    if (migrations.some((migration) => migration.version === match[1])) {
      throw new Error(`Duplicate migration version ${match[1]}`);
    }
    const sql = (await readFile(new URL(file, directory), 'utf8')).replace(/\r\n/g, '\n');
    migrations.push({
      version: match[1],
      name: match[2],
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  return migrations;
}

/**
 * Applies pending migrations in order, each in its own transaction. Fails when an applied
 * migration was edited or removed, so the schema never drifts silently from the files.
 * Must run with the owner role, never with a service role.
 */
export async function migrate(client: ClientBase, migrations: readonly Migration[]): Promise<string[]> {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS app_meta');
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_meta.schema_migrations (
        version    text PRIMARY KEY,
        name       text NOT NULL,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM app_meta.schema_migrations ORDER BY version',
    );

    for (const applied of rows) {
      const file = migrations.find((migration) => migration.version === applied.version);
      if (file === undefined) {
        throw new Error(`Applied migration ${applied.version} is missing from the migrations directory`);
      }
      if (file.checksum !== applied.checksum) {
        throw new Error(`Applied migration ${applied.version} was modified; add a new migration instead`);
      }
    }

    const appliedVersions = new Set(rows.map((row) => row.version));
    const newlyApplied: string[] = [];
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO app_meta.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        // A failing ROLLBACK must not hide the original error.
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${migration.version}_${migration.name} failed`, { cause: error });
      }
      newlyApplied.push(`${migration.version}_${migration.name}`);
    }
    return newlyApplied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
  }
}

type ServiceGroup = 'app_api' | 'app_admin';
const ROLE_NAME = /^findemes_[a-z_]{1,40}$/;
const SCRAM_ITERATIONS = 4096;

/**
 * SCRAM-SHA-256 verifier computed on the client, so the clear password never travels in the
 * CREATE/ALTER ROLE statement and cannot end up in the server log or pg_stat_activity.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16)): string {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, SCRAM_ITERATIONS, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${String(SCRAM_ITERATIONS)}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/**
 * Creates or updates a LOGIN role that belongs to exactly one service group. Explicitly without
 * superuser, role creation or RLS bypass.
 */
export async function ensureLoginRole(
  client: ClientBase,
  roleName: string,
  group: ServiceGroup,
  password: string,
): Promise<void> {
  if (!ROLE_NAME.test(roleName)) {
    throw new Error(`Invalid role name ${roleName}`);
  }
  if (password.length < 16) {
    throw new Error(`Password for ${roleName} must have at least 16 characters`);
  }
  const verifier = client.escapeLiteral(scramVerifier(password));
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [roleName]);
  const verb = rowCount === 0 ? 'CREATE' : 'ALTER';
  await client.query(
    `${verb} ROLE ${roleName} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT PASSWORD ${verifier}`,
  );
  const other: ServiceGroup = group === 'app_api' ? 'app_admin' : 'app_api';
  await client.query(`REVOKE ${other} FROM ${roleName}`);
  await client.query(`GRANT ${group} TO ${roleName}`);
}

export interface MigrationRun {
  readonly applied: readonly string[];
}

/** Connects with the owner role, applies migrations and optionally sets the login roles. */
export async function runMigrations(options: {
  readonly ownerUrl: string;
  readonly apiPassword?: string | undefined;
  readonly adminPassword?: string | undefined;
}): Promise<MigrationRun> {
  const client = new pg.Client({ connectionString: options.ownerUrl });
  await client.connect();
  try {
    const applied = await migrate(client, await loadMigrations());
    if (options.apiPassword) {
      await ensureLoginRole(client, 'findemes_api', 'app_api', options.apiPassword);
    }
    if (options.adminPassword) {
      await ensureLoginRole(client, 'findemes_admin', 'app_admin', options.adminPassword);
    }
    return { applied };
  } finally {
    await client.end();
  }
}
