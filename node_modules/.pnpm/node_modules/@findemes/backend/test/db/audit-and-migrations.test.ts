// Append-only hash-chained audit trail (RNF10, HU25) and migration safety.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, migrate } from '../../src/adapters/postgres/migrator.ts';
import { createTestDatabase, createUser, errorCode, type TestDatabase } from './harness.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  // beforeAll may fail before the database exists.
  await (db as TestDatabase | undefined)?.drop();
});

async function appendEntry(
  pool: pg.Pool,
  actorType: 'user' | 'admin' | 'system',
  action = 'registry.income_created',
  details = '{}',
): Promise<void> {
  await pool.query(
    `INSERT INTO app.audit_log (actor_type, actor_id, action, target_type, origin_ip, details, occurred_at, prev_hash, hash, seq)
     VALUES ($1, gen_random_uuid(), $2, 'income', '203.0.113.7', $3::jsonb, '2000-01-01', '\\x00', '\\x00', 999)`,
    [actorType, action, details],
  );
}

describe('audit trail', () => {
  it('lets the API append but never read entries', async () => {
    await appendEntry(db.api, 'user');
    expect(await errorCode(db.api.query('SELECT * FROM app.audit_log'))).toBe('42501');
  });

  it('sets time and chain fields on the server, ignoring caller values', async () => {
    const { rows } = await db.owner.query<{ seq: string; year: number; linked: boolean }>(
      `SELECT seq, extract(year FROM occurred_at)::int AS year, length(hash) = 32 AS linked FROM app.audit_log ORDER BY seq LIMIT 1`,
    );
    expect(rows[0]).toEqual({ seq: '1', year: new Date().getUTCFullYear(), linked: true });
  });

  it('only lets each service record its own kind of actor', async () => {
    expect(await errorCode(appendEntry(db.api, 'admin', 'user.suspend'))).toBe('42501');
    expect(await errorCode(appendEntry(db.admin, 'user'))).toBe('42501');
    await appendEntry(db.admin, 'admin', 'user.suspend');
    await appendEntry(db.api, 'system', 'aggregation.sync');
  });

  it('rejects personal or financial values in details', async () => {
    expect(await errorCode(appendEntry(db.api, 'user', 'registry.income_created', '{"amount": 900000}'))).toBe('23514');
    expect(await errorCode(appendEntry(db.api, 'user', 'identity.login', '{"email": "ana@example.cl"}'))).toBe('23514');
    await appendEntry(db.api, 'user', 'registry.income_updated', '{"fields": ["amount"]}');
  });

  it('cannot be updated or deleted by the services', async () => {
    expect(await errorCode(db.api.query(`UPDATE app.audit_log SET action = 'x'`))).toBe('42501');
    expect(await errorCode(db.admin.query(`DELETE FROM app.audit_log`))).toBe('42501');
  });

  it('cannot be updated, deleted or truncated even by the owner', async () => {
    expect(await errorCode(db.owner.query(`UPDATE app.audit_log SET action = 'tampered'`))).toBe('42501');
    expect(await errorCode(db.owner.query(`DELETE FROM app.audit_log`))).toBe('42501');
    expect(await errorCode(db.owner.query(`TRUNCATE app.audit_log`))).toBe('42501');
  });

  it('keeps an intact chain across many entries and concurrent writers', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? appendEntry(db.api, 'user') : appendEntry(db.admin, 'admin'))));
    const { rows } = await db.admin.query<{ broken: string | null }>('SELECT app.verify_audit_chain() AS broken');
    expect(rows[0]?.broken).toBeNull();
  });

  it('detects tampering with a past entry', async () => {
    await appendEntry(db.api, 'user', 'registry.target_of_tampering');
    await appendEntry(db.api, 'user');
    const { rows: target } = await db.owner.query<{ seq: string }>(
      `SELECT seq FROM app.audit_log WHERE action = 'registry.target_of_tampering'`,
    );
    const seq = target[0]?.seq;
    await db.owner.query('ALTER TABLE app.audit_log DISABLE TRIGGER audit_log_no_update_delete');
    await db.owner.query(`UPDATE app.audit_log SET action = 'registry.nothing_happened' WHERE seq = $1`, [seq]);
    await db.owner.query('ALTER TABLE app.audit_log ENABLE TRIGGER audit_log_no_update_delete');
    const { rows } = await db.admin.query<{ broken: string | null }>('SELECT app.verify_audit_chain() AS broken');
    expect(rows[0]?.broken).toBe(seq);
  });
});

describe('admin login lookup', () => {
  it('returns credentials only for platform administrators (HU22)', async () => {
    const admin = await createUser(db, 'admin@example.cl');
    await createUser(db, 'user@example.cl');
    await db.owner.query(
      `INSERT INTO app.platform_admins (user_id, totp_secret_ciphertext, totp_nonce, totp_key_version) VALUES ($1, '\\x01', '\\x000000000000000000000000', 1)`,
      [admin],
    );
    const found = await db.admin.query('SELECT user_id FROM app.lookup_admin_login($1)', ['admin@example.cl']);
    const notAdmin = await db.admin.query('SELECT user_id FROM app.lookup_admin_login($1)', ['user@example.cl']);
    expect(found.rows).toEqual([{ user_id: admin }]);
    expect(notAdmin.rowCount).toBe(0);
  });

  it('is not available to the public API role', async () => {
    expect(await errorCode(db.api.query(`SELECT * FROM app.lookup_admin_login('admin@example.cl')`))).toBe('42501');
    expect(await errorCode(db.api.query('SELECT * FROM app.platform_admins'))).toBe('42501');
  });
});

describe('migrations', () => {
  it('apply nothing when the database is up to date', async () => {
    const client = await db.owner.connect();
    try {
      expect(await migrate(client, await loadMigrations())).toEqual([]);
    } finally {
      client.release();
    }
  });

  it('refuse to run when an applied migration was edited', async () => {
    const migrations = await loadMigrations();
    const edited = migrations.map((m, i) => (i === 0 ? { ...m, checksum: 'edited' } : m));
    const client = await db.owner.connect();
    try {
      await expect(migrate(client, edited)).rejects.toThrow(/was modified/);
    } finally {
      client.release();
    }
  });

  it('refuse to run when an applied migration is missing', async () => {
    const client = await db.owner.connect();
    try {
      await expect(migrate(client, (await loadMigrations()).slice(1))).rejects.toThrow(/is missing/);
    } finally {
      client.release();
    }
  });
});
