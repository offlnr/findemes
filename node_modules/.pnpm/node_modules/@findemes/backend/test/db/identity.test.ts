// Session and credential functions (HU17, HU17.1-HU17.3).
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDatabase, createUser, type TestDatabase } from './harness.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  // beforeAll may fail before the database exists.
  await (db as TestDatabase | undefined)?.drop();
});

const newToken = (): Buffer => createHash('sha256').update(randomBytes(32)).digest();

async function startSession(userId: string): Promise<Buffer> {
  const hash = newToken();
  await asUser(db.api, userId, (c) =>
    c.query(
      `INSERT INTO app.refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1, gen_random_uuid(), $2, now() + interval '30 days')`,
      [userId, hash],
    ),
  );
  return hash;
}

async function rotate(oldHash: Buffer, newHash: Buffer): Promise<{ result: string; result_user_id: string | null }> {
  const { rows } = await db.api.query<{ result: string; result_user_id: string | null }>(
    `SELECT * FROM app.rotate_refresh_token($1, $2, now() + interval '30 days')`,
    [oldHash, newHash],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('no result');
  }
  return row;
}

describe('lookup_login', () => {
  it('finds an account by normalized email without RLS context', async () => {
    const id = await createUser(db, 'ana@example.cl');
    const { rows } = await db.api.query('SELECT user_id, status FROM app.lookup_login($1)', ['  ANA@Example.cl ']);
    expect(rows).toEqual([{ user_id: id, status: 'active' }]);
  });

  it('returns nothing for unknown emails', async () => {
    const { rowCount } = await db.api.query('SELECT 1 FROM app.lookup_login($1)', ['nadie@example.cl']);
    expect(rowCount).toBe(0);
  });
});

describe('rotate_refresh_token', () => {
  it('rotates a valid token once', async () => {
    const user = await createUser(db);
    const first = await startSession(user);
    const second = newToken();
    expect(await rotate(first, second)).toEqual({ result: 'rotated', result_user_id: user });
    expect((await rotate(second, newToken())).result).toBe('rotated');
  });

  it('revokes the whole family when a consumed token is reused', async () => {
    const user = await createUser(db);
    const first = await startSession(user);
    const second = newToken();
    await rotate(first, second);

    expect((await rotate(first, newToken())).result).toBe('reused');
    // The legitimate successor is revoked too: the attacker and the user must log in again.
    expect((await rotate(second, newToken())).result).toBe('invalid');
  });

  it('rejects unknown and expired tokens', async () => {
    const user = await createUser(db);
    expect((await rotate(newToken(), newToken())).result).toBe('invalid');
    const expired = await startSession(user);
    await db.owner.query(`UPDATE app.refresh_tokens SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE token_hash = $1`, [expired]);
    expect((await rotate(expired, newToken())).result).toBe('invalid');
  });

  it('rejects tokens of suspended accounts (HU23)', async () => {
    const user = await createUser(db);
    const token = await startSession(user);
    await db.admin.query(`UPDATE app.users SET status = 'suspended' WHERE id = $1`, [user]);
    expect((await rotate(token, newToken())).result).toBe('invalid');
  });
});

describe('consume_email_token', () => {
  async function issue(userId: string, purpose: string, minutes: number): Promise<Buffer> {
    const hash = newToken();
    await asUser(db.api, userId, (c) =>
      c.query(
        `INSERT INTO app.email_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
        [userId, purpose, hash, minutes],
      ),
    );
    return hash;
  }

  async function consume(hash: Buffer, purpose: string): Promise<string | null> {
    const { rows } = await db.api.query<{ id: string | null }>('SELECT app.consume_email_token($1, $2) AS id', [hash, purpose]);
    return rows[0]?.id ?? null;
  }

  it('is single use', async () => {
    const user = await createUser(db);
    const hash = await issue(user, 'reset_password', 30);
    expect(await consume(hash, 'reset_password')).toBe(user);
    expect(await consume(hash, 'reset_password')).toBeNull();
  });

  it('marks the email as verified when a verification token is consumed (HU17)', async () => {
    const user = await createUser(db);
    const hash = await issue(user, 'verify_email', 60 * 24);
    expect(await consume(hash, 'verify_email')).toBe(user);
    const { rows } = await db.owner.query<{ verified: boolean }>(
      'SELECT email_verified_at IS NOT NULL AS verified FROM app.users WHERE id = $1',
      [user],
    );
    expect(rows[0]?.verified).toBe(true);
  });

  it('only works for its own purpose', async () => {
    const user = await createUser(db);
    const hash = await issue(user, 'verify_email', 60 * 24);
    expect(await consume(hash, 'reset_password')).toBeNull();
    expect(await consume(hash, 'verify_email')).toBe(user);
  });

  it('expires', async () => {
    const user = await createUser(db);
    const hash = await issue(user, 'reset_password', 30);
    await db.owner.query(`UPDATE app.email_tokens SET created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [hash]);
    expect(await consume(hash, 'reset_password')).toBeNull();
  });
});

describe('stored credentials', () => {
  it('only accept argon2id password hashes (RNF07)', async () => {
    await expect(
      db.owner.query(`INSERT INTO app.users (email, password_hash) VALUES ('x@example.cl', 'plaintext')`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('reject emails that are not normalized', async () => {
    await expect(
      db.owner.query(`INSERT INTO app.users (email, password_hash) VALUES ('Ana@Example.cl', '$argon2id$x')`),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
