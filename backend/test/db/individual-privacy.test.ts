// Cross-access tests for individual data (rule 5, RNF08, HU16, HU23).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDatabase, createUser, errorCode, type TestDatabase } from './harness.ts';
import { TEST_ADMIN_ROLE, TEST_API_ROLE } from './settings.ts';

const INSUFFICIENT_PRIVILEGE = '42501';

let db: TestDatabase;
let ana: string;
let bruno: string;

/** Individual tables and a statement that inserts one row owned by $1. */
const OWNED_ROWS: readonly { table: string; insert: string }[] = [
  {
    table: 'financial_profiles',
    insert: `INSERT INTO app.financial_profiles (owner_id, opening_balance, balance_month) VALUES ($1, 250000, '2026-10-01')`,
  },
  {
    table: 'incomes',
    insert: `INSERT INTO app.incomes (owner_id, label, amount, schedule_kind, from_month) VALUES ($1, 'Sueldo', 1250000, 'monthly', '2026-10-01')`,
  },
  {
    table: 'expenses',
    insert: `INSERT INTO app.expenses (owner_id, label, nature, amount, schedule_kind, from_month) VALUES ($1, 'Arriendo', 'fixed', 520000, 'monthly', '2026-10-01')`,
  },
  {
    table: 'debts',
    insert: `INSERT INTO app.debts (owner_id, label) VALUES ($1, 'Tarjeta')`,
  },
  {
    table: 'bank_links',
    insert: `INSERT INTO app.bank_links (owner_id, provider, provider_link_id, institution_name, token_ciphertext, token_nonce, token_key_version, origin)
             VALUES ($1, 'demo', 'demo:familia', 'Banco Demo', '\\x01', '\\x000000000000000000000000', 1, 'demo')`,
  },
];

beforeAll(async () => {
  db = await createTestDatabase();
  ana = await createUser(db);
  bruno = await createUser(db);
  for (const { insert } of OWNED_ROWS) {
    await asUser(db.api, ana, (client) => client.query(insert, [ana]));
  }
  await createScenario(ana);
});

async function createScenario(userId: string): Promise<void> {
  await asUser(db.api, userId, (c) =>
    c.query(`SELECT app.create_scenario_if_under_limit(gen_random_uuid(), 'Comprar notebook', 'personal', NULL, '[]'::jsonb)`),
  );
}

afterAll(async () => {
  // beforeAll may fail before the database exists.
  await (db as TestDatabase | undefined)?.drop();
});

describe.each(OWNED_ROWS)('$table', ({ table, insert }) => {
  it('is visible to its owner', async () => {
    const { rowCount } = await asUser(db.api, ana, (c) => c.query(`SELECT 1 FROM app.${table}`));
    expect(rowCount).toBe(1);
  });

  it('is invisible to another user', async () => {
    const { rowCount } = await asUser(db.api, bruno, (c) => c.query(`SELECT 1 FROM app.${table}`));
    expect(rowCount).toBe(0);
  });

  it('is invisible when no user is set (deny by default)', async () => {
    const { rowCount } = await asUser(db.api, null, (c) => c.query(`SELECT 1 FROM app.${table}`));
    expect(rowCount).toBe(0);
  });

  it('cannot be updated or deleted by another user', async () => {
    const updated = await asUser(db.api, bruno, (c) =>
      c.query(`UPDATE app.${table} SET owner_id = $1 WHERE owner_id = $2`, [bruno, ana]),
    );
    const deleted = await asUser(db.api, bruno, (c) => c.query(`DELETE FROM app.${table}`));
    expect(updated.rowCount).toBe(0);
    expect(deleted.rowCount).toBe(0);
  });

  it('cannot be created on behalf of another user', async () => {
    expect(await errorCode(asUser(db.api, bruno, (c) => c.query(insert, [ana])))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('is not readable by the admin API role (HU23)', async () => {
    expect(await errorCode(db.admin.query(`SELECT 1 FROM app.${table}`))).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('scenarios', () => {
  it('are visible only to their owner', async () => {
    const own = await asUser(db.api, ana, (c) => c.query('SELECT 1 FROM app.scenarios'));
    const other = await asUser(db.api, bruno, (c) => c.query('SELECT 1 FROM app.scenarios'));
    const nobody = await asUser(db.api, null, (c) => c.query('SELECT 1 FROM app.scenarios'));
    expect([own.rowCount, other.rowCount, nobody.rowCount]).toEqual([1, 0, 0]);
  });

  it('cannot be updated or deleted by another user', async () => {
    const updated = await asUser(db.api, bruno, (c) => c.query(`UPDATE app.scenarios SET name = 'x'`));
    const deleted = await asUser(db.api, bruno, (c) => c.query('DELETE FROM app.scenarios'));
    expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
  });

  it('can only be created through the plan-limited function', async () => {
    const code = await errorCode(
      asUser(db.api, bruno, (c) =>
        c.query(`INSERT INTO app.scenarios (owner_id, name, base_kind) VALUES ($1, 'X', 'personal')`, [bruno]),
      ),
    );
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('are not readable by the admin API role (HU23)', async () => {
    expect(await errorCode(db.admin.query('SELECT 1 FROM app.scenarios'))).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('debt installments', () => {
  it('cannot be attached to another user\'s debt', async () => {
    const { rows } = await asUser(db.api, ana, (c) => c.query<{ id: string }>('SELECT id FROM app.debts'));
    const debtId = rows[0]?.id;
    const code = await errorCode(
      asUser(db.api, bruno, (c) =>
        c.query(`INSERT INTO app.debt_installments (debt_id, owner_id, month, amount) VALUES ($1, $2, '2026-11-01', 45000)`, [
          debtId,
          bruno,
        ]),
      ),
    );
    // Foreign key (debt_id, owner_id) does not exist for Bruno.
    expect(code).toBe('23503');
  });
});

describe('accounts', () => {
  it('let a user read only their own account', async () => {
    const { rows } = await asUser(db.api, bruno, (c) => c.query<{ id: string }>('SELECT id FROM app.users'));
    expect(rows.map((row) => row.id)).toEqual([bruno]);
  });

  it('do not let a user change their own status (only administrators suspend)', async () => {
    const code = await errorCode(asUser(db.api, bruno, (c) => c.query(`UPDATE app.users SET status = 'active'`)));
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('let the admin role list and suspend accounts without seeing password hashes (HU23)', async () => {
    const { rowCount } = await db.admin.query('SELECT id, email, status FROM app.users');
    expect(rowCount).toBe(2);
    expect(await errorCode(db.admin.query('SELECT password_hash FROM app.users'))).toBe(INSUFFICIENT_PRIVILEGE);
    const suspended = await db.admin.query(`UPDATE app.users SET status = 'suspended' WHERE id = $1`, [bruno]);
    expect(suspended.rowCount).toBe(1);
    await db.admin.query(`UPDATE app.users SET status = 'active' WHERE id = $1`, [bruno]);
  });

  it('record the initial-registration timestamps for the KPI, readable by the admin role', async () => {
    const gabi = await createUser(db);
    await asUser(db.api, gabi, (c) =>
      c.query(`UPDATE app.users SET onboarding_started_at = now() - interval '5 minutes', onboarding_completed_at = now()`),
    );
    const { rows } = await db.admin.query<{ minutes: number }>(
      `SELECT extract(epoch FROM onboarding_completed_at - onboarding_started_at) / 60 AS minutes FROM app.users WHERE id = $1`,
      [gabi],
    );
    expect(Number(rows[0]?.minutes)).toBeCloseTo(5);
    expect(await errorCode(db.admin.query(`UPDATE app.users SET onboarding_started_at = now() WHERE id = $1`, [gabi]))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('reject a registration completed before it started', async () => {
    const hugo = await createUser(db);
    const code = await errorCode(asUser(db.api, hugo, (c) => c.query('UPDATE app.users SET onboarding_completed_at = now()')));
    expect(code).toBe('23514');
  });

  it('do not let a user mark their own email as verified (only a valid email token does)', async () => {
    const code = await errorCode(asUser(db.api, bruno, (c) => c.query('UPDATE app.users SET email_verified_at = now()')));
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('erase every individual row when the account is deleted (HU21)', async () => {
    const carla = await createUser(db);
    for (const { insert } of OWNED_ROWS) {
      await asUser(db.api, carla, (c) => c.query(insert, [carla]));
    }
    await createScenario(carla);
    await asUser(db.api, carla, (c) =>
      c.query(`INSERT INTO app.consents (owner_id, kind, document_version) VALUES ($1, 'terms', '2026-10')`, [carla]),
    );
    const deleted = await asUser(db.api, carla, (c) => c.query('DELETE FROM app.users WHERE id = $1', [carla]));
    expect(deleted.rowCount).toBe(1);
    for (const table of [...OWNED_ROWS.map((row) => row.table), 'scenarios', 'consents']) {
      const { rowCount } = await db.owner.query(`SELECT 1 FROM app.${table} WHERE owner_id = $1`, [carla]);
      expect(rowCount, table).toBe(0);
    }
  });
});

describe('consents (Ley 21.719)', () => {
  const ACCEPT = `INSERT INTO app.consents (owner_id, kind, document_version) VALUES ($1, $2, '2026-10') RETURNING id`;

  it('are visible only to their owner', async () => {
    const dana = await createUser(db);
    await asUser(db.api, dana, (c) => c.query(ACCEPT, [dana, 'terms']));
    const own = await asUser(db.api, dana, (c) => c.query('SELECT 1 FROM app.consents'));
    const other = await asUser(db.api, bruno, (c) => c.query('SELECT 1 FROM app.consents WHERE owner_id = $1', [dana]));
    const nobody = await asUser(db.api, null, (c) => c.query('SELECT 1 FROM app.consents'));
    expect([own.rowCount, other.rowCount, nobody.rowCount]).toEqual([1, 0, 0]);
  });

  it('cannot be recorded on behalf of another user', async () => {
    expect(await errorCode(asUser(db.api, bruno, (c) => c.query(ACCEPT, [ana, 'terms'])))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('can be withdrawn but never rewritten or deleted', async () => {
    const elena = await createUser(db);
    const { rows } = await asUser(db.api, elena, (c) => c.query<{ id: string }>(ACCEPT, [elena, 'bank_connection']));
    const id = rows[0]?.id;
    const withdrawn = await asUser(db.api, elena, (c) => c.query('UPDATE app.consents SET withdrawn_at = now() WHERE id = $1', [id]));
    expect(withdrawn.rowCount).toBe(1);
    expect(
      await errorCode(asUser(db.api, elena, (c) => c.query(`UPDATE app.consents SET document_version = '2027-01' WHERE id = $1`, [id]))),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await errorCode(asUser(db.api, elena, (c) => c.query('DELETE FROM app.consents WHERE id = $1', [id])))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('allow only one active consent of each kind, keeping the history', async () => {
    const fede = await createUser(db);
    await asUser(db.api, fede, (c) => c.query(ACCEPT, [fede, 'privacy_policy']));
    expect(await errorCode(asUser(db.api, fede, (c) => c.query(ACCEPT, [fede, 'privacy_policy'])))).toBe('23505');
    await asUser(db.api, fede, (c) => c.query(`UPDATE app.consents SET withdrawn_at = now() WHERE kind = 'privacy_policy'`));
    await asUser(db.api, fede, (c) => c.query(ACCEPT, [fede, 'privacy_policy']));
    const { rowCount } = await asUser(db.api, fede, (c) => c.query(`SELECT 1 FROM app.consents WHERE kind = 'privacy_policy'`));
    expect(rowCount).toBe(2);
  });

  it('are not readable by the admin API role', async () => {
    expect(await errorCode(db.admin.query('SELECT 1 FROM app.consents'))).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('service roles', () => {
  it('have no superuser, role creation or RLS bypass privileges', async () => {
    const { rows } = await db.owner.query<{ rolname: string; rolsuper: boolean; rolcreaterole: boolean; rolbypassrls: boolean }>(
      `SELECT rolname, rolsuper, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname IN ($1, $2, 'app_api', 'app_admin')`,
      [TEST_API_ROLE, TEST_ADMIN_ROLE],
    );
    expect(rows).toHaveLength(4);
    for (const role of rows) {
      expect(role, role.rolname).toMatchObject({ rolsuper: false, rolcreaterole: false, rolbypassrls: false });
    }
  });

  it('cannot create objects in the application schema', async () => {
    expect(await errorCode(db.api.query('CREATE TABLE app.intruder (id int)'))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('cannot read the migration bookkeeping', async () => {
    expect(await errorCode(db.api.query('SELECT * FROM app_meta.schema_migrations'))).toBe(INSUFFICIENT_PRIVILEGE);
  });
});

describe('function privileges', () => {
  // Explicit allowlist: any other function must not be executable by a service role.
  const EXPECTED: Readonly<Record<string, readonly string[]>> = {
    [TEST_API_ROLE]: [
      'accept_household_invitation',
      'cancel_subscription',
      'consume_email_token',
      'create_household',
      'create_scenario_if_under_limit',
      'current_user_id',
      'is_household_admin',
      'is_household_member',
      'lookup_login',
      'rotate_refresh_token',
      'settle_payment_order',
    ],
    [TEST_ADMIN_ROLE]: ['current_user_id', 'lookup_admin_login', 'verify_audit_chain'],
  };

  it.each(Object.keys(EXPECTED))('let %s execute only its allowlisted functions', async (role) => {
    const { rows } = await db.owner.query<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'app' AND has_function_privilege($1, p.oid, 'EXECUTE') ORDER BY p.proname`,
      [role],
    );
    expect(rows.map((row) => row.proname)).toEqual(EXPECTED[role]);
  });
});
