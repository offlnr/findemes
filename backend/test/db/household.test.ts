// Household privacy and rules (rule 5, RNF08, HU12-HU16, HU31).
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDatabase, createUser, errorCode, type TestDatabase } from './harness.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  // beforeAll may fail before the database exists.
  await (db as TestDatabase | undefined)?.drop();
});

const sha256 = (value: Buffer): Buffer => createHash('sha256').update(value).digest();

async function createHousehold(adminId: string, name = 'Casa'): Promise<string> {
  const { rows } = await asUser(db.api, adminId, (c) =>
    c.query<{ id: string }>('SELECT app.create_household($1, $2) AS id', [name, 'Admin']),
  );
  return rows[0]?.id ?? '';
}

async function invite(adminId: string, householdId: string, expiresInMinutes = 60): Promise<Buffer> {
  const token = randomBytes(32);
  await asUser(db.api, adminId, (c) =>
    c.query(
      `INSERT INTO app.household_invitations (household_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [householdId, sha256(token), expiresInMinutes],
    ),
  );
  return token;
}

async function accept(userId: string, token: Buffer, displayName = 'Miembro'): Promise<string | null> {
  const { rows } = await asUser(db.api, userId, (c) =>
    c.query<{ id: string | null }>('SELECT app.accept_household_invitation($1, $2) AS id', [sha256(token), displayName]),
  );
  return rows[0]?.id ?? null;
}

async function addSharedExpense(userId: string, householdId: string, label = 'Arriendo'): Promise<string> {
  const { rows } = await asUser(db.api, userId, (c) =>
    c.query<{ id: string }>(
      `INSERT INTO app.household_expenses (household_id, created_by, label, amount, schedule_kind, from_month)
       VALUES ($1, $2, $3, 600000, 'monthly', '2026-10-01') RETURNING id`,
      [householdId, userId, label],
    ),
  );
  return rows[0]?.id ?? '';
}

async function createHouseholdScenario(userId: string, householdId: string): Promise<void> {
  await asUser(db.api, userId, (c) =>
    c.query(`SELECT app.create_scenario_if_under_limit(gen_random_uuid(), 'Mío', 'household', $1, '[]'::jsonb)`, [householdId]),
  );
}

describe('household membership', () => {
  it('lets a member join only with a valid invitation, once (HU12, HU31)', async () => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const latecomer = await createUser(db);
    const household = await createHousehold(admin);
    const token = await invite(admin, household);

    expect(await accept(member, token)).toBe(household);
    expect(await accept(latecomer, token)).toBeNull();
    expect(await accept(latecomer, randomBytes(32))).toBeNull();
  });

  it('rejects expired invitations', async () => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const household = await createHousehold(admin);
    const token = await invite(admin, household);
    await db.owner.query(
      `UPDATE app.household_invitations SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE token_hash = $1`,
      [sha256(token)],
    );
    expect(await accept(member, token)).toBeNull();
  });

  it('limits invitations to 7 days of validity (HU31)', async () => {
    const admin = await createUser(db);
    const household = await createHousehold(admin);
    expect(await errorCode(invite(admin, household, 8 * 24 * 60))).toBe('23514');
  });

  it('does not let a user insert themselves into a household directly', async () => {
    const admin = await createUser(db);
    const intruder = await createUser(db);
    const household = await createHousehold(admin);
    const code = await errorCode(
      asUser(db.api, intruder, (c) =>
        c.query(`INSERT INTO app.household_members (household_id, user_id, role, display_name) VALUES ($1, $2, 'admin', 'X')`, [
          household,
          intruder,
        ]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('only lets the admin create invitations', async () => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const household = await createHousehold(admin);
    await accept(member, await invite(admin, household));
    expect(await errorCode(invite(member, household))).toBe('42501');
  });

  it('shows members only their display names, never their email', async () => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const household = await createHousehold(admin);
    await accept(member, await invite(admin, household), 'Bruno');
    const { rows } = await asUser(db.api, member, (c) =>
      c.query<{ display_name: string }>('SELECT display_name FROM app.household_members ORDER BY display_name'),
    );
    expect(rows.map((row) => row.display_name)).toEqual(['Admin', 'Bruno']);
    const users = await asUser(db.api, member, (c) => c.query('SELECT email FROM app.users'));
    expect(users.rowCount).toBe(1);
  });
});

describe('information flow (rule 5)', () => {
  let admin: string;
  let member: string;
  let outsider: string;
  let household: string;

  beforeAll(async () => {
    admin = await createUser(db);
    member = await createUser(db);
    outsider = await createUser(db);
    household = await createHousehold(admin);
    await accept(member, await invite(admin, household));
    await addSharedExpense(admin, household);
    await asUser(db.api, member, (c) =>
      c.query(
        `INSERT INTO app.incomes (owner_id, label, amount, schedule_kind, from_month) VALUES ($1, 'Sueldo privado', 900000, 'monthly', '2026-10-01')`,
        [member],
      ),
    );
  });

  it('shows every shared expense and its author to all members (HU13)', async () => {
    const { rows } = await asUser(db.api, member, (c) =>
      c.query<{ label: string; created_by: string }>('SELECT label, created_by FROM app.household_expenses'),
    );
    expect(rows).toEqual([{ label: 'Arriendo', created_by: admin }]);
  });

  it("never shows a member's individual data to the household admin (HU16)", async () => {
    const { rowCount } = await asUser(db.api, admin, (c) => c.query('SELECT 1 FROM app.incomes'));
    expect(rowCount).toBe(0);
  });

  it('hides the household from non-members', async () => {
    for (const table of ['households', 'household_members', 'household_expenses', 'contribution_rules']) {
      const { rowCount } = await asUser(db.api, outsider, (c) => c.query(`SELECT 1 FROM app.${table}`));
      expect(rowCount, table).toBe(0);
    }
  });

  it('does not let a non-member add shared expenses', async () => {
    expect(await errorCode(addSharedExpense(outsider, household))).toBe('42501');
  });

  it('only lets the author or the admin edit a shared expense', async () => {
    const memberExpense = await addSharedExpense(member, household, 'Internet');
    const byAdmin = await asUser(db.api, admin, (c) =>
      c.query('UPDATE app.household_expenses SET amount = 25000 WHERE id = $1', [memberExpense]),
    );
    expect(byAdmin.rowCount).toBe(1);
    const adminExpense = await addSharedExpense(admin, household, 'Luz');
    const byMember = await asUser(db.api, member, (c) =>
      c.query('UPDATE app.household_expenses SET amount = 1 WHERE id = $1', [adminExpense]),
    );
    expect(byMember.rowCount).toBe(0);
  });

  it('does not let a user base a scenario on a household they do not belong to', async () => {
    const code = await errorCode(
      asUser(db.api, outsider, (c) =>
        c.query(`SELECT app.create_scenario_if_under_limit(gen_random_uuid(), 'X', 'household', $1, '[]'::jsonb)`, [household]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('does not let a member rewrite the author or the household of a shared expense', async () => {
    const expense = await addSharedExpense(member, household, 'Cable');
    for (const column of ['created_by', 'household_id', 'created_by_name']) {
      const code = await errorCode(
        asUser(db.api, member, (c) => c.query(`UPDATE app.household_expenses SET ${column} = ${column} WHERE id = $1`, [expense])),
      );
      expect(code, column).toBe('42501');
    }
  });

  it('shows the author by display name, set by the server', async () => {
    const { rows } = await asUser(db.api, member, (c) =>
      c.query<{ created_by_name: string }>(
        `INSERT INTO app.household_expenses (household_id, created_by, created_by_name, label, amount, schedule_kind, from_month)
         VALUES ($1, $2, 'Alguien más', 'Gas', 30000, 'monthly', '2026-10-01') RETURNING created_by_name`,
        [household, member],
      ),
    );
    expect(rows[0]?.created_by_name).toBe('Miembro');
  });

  it('does not reveal to outsiders whether someone belongs to a household', async () => {
    const expense = await addSharedExpense(admin, household, 'Seguro');
    // Naming a real member and a non-member must fail the same way for an outsider.
    for (const named of [member, outsider]) {
      const code = await errorCode(
        asUser(db.api, outsider, (c) =>
          c.query(
            `INSERT INTO app.contribution_rules (expense_id, household_id, mode, assigned_user_id) VALUES ($1, $2, 'assigned', $3)`,
            [expense, household, named],
          ),
        ),
      );
      expect(code).toBe('42501');
    }
  });
});

describe('contribution rules (HU14)', () => {
  let admin: string;
  let member: string;
  let household: string;

  beforeAll(async () => {
    admin = await createUser(db);
    member = await createUser(db);
    household = await createHousehold(admin);
    await accept(member, await invite(admin, household));
  });

  async function percentageRule(expenseId: string, shares: readonly [string, number][]): Promise<void> {
    await asUser(db.api, admin, async (c) => {
      await c.query(`INSERT INTO app.contribution_rules (expense_id, household_id, mode) VALUES ($1, $2, 'percentage')`, [
        expenseId,
        household,
      ]);
      for (const [userId, basisPoints] of shares) {
        await c.query(
          'INSERT INTO app.contribution_shares (expense_id, household_id, user_id, basis_points) VALUES ($1, $2, $3, $4)',
          [expenseId, household, userId, basisPoints],
        );
      }
    });
  }

  it('accepts percentages that add up to 100 %', async () => {
    const expense = await addSharedExpense(admin, household, 'Gastos comunes');
    await expect(percentageRule(expense, [[admin, 6000], [member, 4000]])).resolves.toBeUndefined();
  });

  it('rejects percentages that do not add up to 100 %', async () => {
    const expense = await addSharedExpense(admin, household, 'Agua');
    expect(await errorCode(percentageRule(expense, [[admin, 6000], [member, 3000]]))).toBe('23514');
  });

  it('rejects shares for people outside the household', async () => {
    const stranger = await createUser(db);
    const expense = await addSharedExpense(admin, household, 'Gas');
    expect(await errorCode(percentageRule(expense, [[admin, 5000], [stranger, 5000]]))).toBe('23514');
  });

  it('only lets the admin configure rules', async () => {
    const expense = await addSharedExpense(member, household, 'Netflix');
    const code = await errorCode(
      asUser(db.api, member, (c) =>
        c.query(`INSERT INTO app.contribution_rules (expense_id, household_id, mode) VALUES ($1, $2, 'equal')`, [
          expense,
          household,
        ]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('falls back to an equal split when a member who had a share leaves', async () => {
    const leaver = await createUser(db);
    await accept(leaver, await invite(admin, household));
    const expense = await addSharedExpense(admin, household, 'Supermercado');
    await percentageRule(expense, [[admin, 5000], [leaver, 5000]]);

    await asUser(db.api, leaver, (c) => c.query('DELETE FROM app.household_members WHERE user_id = $1', [leaver]));

    const { rows } = await db.owner.query<{ mode: string }>('SELECT mode FROM app.contribution_rules WHERE expense_id = $1', [
      expense,
    ]);
    expect(rows[0]?.mode).toBe('equal');
    const shares = await db.owner.query('SELECT 1 FROM app.contribution_shares WHERE expense_id = $1', [expense]);
    expect(shares.rowCount).toBe(0);
  });
});

describe('membership lifecycle', () => {
  it('promotes the longest-standing member when the admin deletes their account (HU21)', async () => {
    const admin = await createUser(db);
    const first = await createUser(db);
    const second = await createUser(db);
    const household = await createHousehold(admin);
    await accept(first, await invite(admin, household));
    await accept(second, await invite(admin, household));

    await asUser(db.api, admin, (c) => c.query('DELETE FROM app.users WHERE id = $1', [admin]));

    const { rows } = await db.owner.query<{ user_id: string; role: string }>(
      'SELECT user_id, role FROM app.household_members WHERE household_id = $1 ORDER BY joined_at',
      [household],
    );
    expect(rows).toEqual([
      { user_id: first, role: 'admin' },
      { user_id: second, role: 'member' },
    ]);
  });

  it('removes the household when its last member leaves', async () => {
    const admin = await createUser(db);
    const household = await createHousehold(admin);
    await addSharedExpense(admin, household);
    await asUser(db.api, admin, (c) => c.query('DELETE FROM app.household_members WHERE user_id = $1', [admin]));
    const { rowCount } = await db.owner.query('SELECT 1 FROM app.households WHERE id = $1', [household]);
    expect(rowCount).toBe(0);
  });

  it('gives a removed member no further write access to the shared space', async () => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const household = await createHousehold(admin);
    await accept(member, await invite(admin, household));
    await addSharedExpense(member, household, 'Internet');
    await asUser(db.api, admin, (c) => c.query('DELETE FROM app.household_members WHERE user_id = $1', [member]));

    const deleted = await asUser(db.api, member, (c) => c.query('DELETE FROM app.household_expenses'));
    const updated = await asUser(db.api, member, (c) => c.query('UPDATE app.household_expenses SET amount = 1'));
    expect([deleted.rowCount, updated.rowCount]).toEqual([0, 0]);
  });

  it('keeps members scenarios as personal ones when the household is deleted (rule 5)', async () => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const household = await createHousehold(admin);
    await accept(member, await invite(admin, household));
    await createHouseholdScenario(member, household);

    await asUser(db.api, admin, (c) => c.query('DELETE FROM app.households WHERE id = $1', [household]));

    const { rows } = await asUser(db.api, member, (c) =>
      c.query<{ base_kind: string; household_id: string | null }>('SELECT base_kind, household_id FROM app.scenarios'),
    );
    expect(rows).toEqual([{ base_kind: 'personal', household_id: null }]);
  });

  it('keeps the household scenarios of a leaving member as personal ones', async () => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const household = await createHousehold(admin);
    await accept(member, await invite(admin, household));
    await createHouseholdScenario(member, household);
    await asUser(db.api, member, (c) => c.query('DELETE FROM app.household_members WHERE user_id = $1', [member]));
    const { rows } = await asUser(db.api, member, (c) => c.query<{ base_kind: string }>('SELECT base_kind FROM app.scenarios'));
    expect(rows).toEqual([{ base_kind: 'personal' }]);
  });

  it('keeps the author name after leaving and anonymizes it after account erasure (HU13, HU21)', async () => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const household = await createHousehold(admin);
    await accept(member, await invite(admin, household), 'Bruno');
    const expense = await addSharedExpense(member, household, 'Luz');

    await asUser(db.api, member, (c) => c.query('DELETE FROM app.household_members WHERE user_id = $1', [member]));
    const afterLeaving = await db.owner.query<{ created_by_name: string }>(
      'SELECT created_by_name FROM app.household_expenses WHERE id = $1',
      [expense],
    );
    expect(afterLeaving.rows[0]?.created_by_name).toBe('Bruno');

    await asUser(db.api, member, (c) => c.query('DELETE FROM app.users WHERE id = $1', [member]));
    const afterErasure = await db.owner.query<{ created_by: string | null; created_by_name: string }>(
      'SELECT created_by, created_by_name FROM app.household_expenses WHERE id = $1',
      [expense],
    );
    expect(afterErasure.rows[0]).toEqual({ created_by: null, created_by_name: 'Ex miembro' });
  });

  it('lets the admin remove a member (HU12)', async () => {
    const admin = await createUser(db);
    const member = await createUser(db);
    const household = await createHousehold(admin);
    await accept(member, await invite(admin, household));
    const removed = await asUser(db.api, admin, (c) =>
      c.query('DELETE FROM app.household_members WHERE user_id = $1', [member]),
    );
    expect(removed.rowCount).toBe(1);
  });
});
