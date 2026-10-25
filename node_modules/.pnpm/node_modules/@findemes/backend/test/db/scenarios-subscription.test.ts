// Plan limits, scenario storage and idempotent payment activation (rule 3, rule 6, Tabla 13, Tabla 14, RNF04).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDatabase, createUser, errorCode, type TestDatabase } from './harness.ts';

const PAID_PRICE = 4990;
const FAMILY_PRICE = 9990;

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await db.owner.query(`UPDATE app.plans SET price_clp = $1 WHERE code = 'paid'`, [PAID_PRICE]);
  await db.owner.query(`UPDATE app.plans SET price_clp = $1 WHERE code = 'family'`, [FAMILY_PRICE]);
});

afterAll(async () => {
  // beforeAll may fail before the database exists.
  await (db as TestDatabase | undefined)?.drop();
});

async function createScenario(userId: string): Promise<string> {
  const { rows } = await asUser(db.api, userId, (c) =>
    c.query<{ result: string }>(
      `SELECT app.create_scenario_if_under_limit($1, 'Escenario', 'personal', NULL, '[]'::jsonb) AS result`,
      [randomUUID()],
    ),
  );
  return rows[0]?.result ?? '';
}

async function order(userId: string, plan = 'paid', amount = PAID_PRICE): Promise<string> {
  const buyOrder = `FDM${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  await asUser(db.api, userId, (c) =>
    c.query('INSERT INTO app.payment_orders (buy_order, user_id, plan_code, amount) VALUES ($1, $2, $3, $4)', [
      buyOrder,
      userId,
      plan,
      amount,
    ]),
  );
  return buyOrder;
}

async function settle(buyOrder: string, userId: string, status: string, amount: number): Promise<string> {
  const { rows } = await db.api.query<{ r: string }>('SELECT app.settle_payment_order($1, $2, $3, $4, $5) AS r', [
    buyOrder,
    userId,
    status,
    amount,
    status === 'authorized' ? '0' : '-1',
  ]);
  return rows[0]?.r ?? '';
}

async function subscription(userId: string): Promise<{ plan_code: string; months: number } | undefined> {
  const { rows } = await db.owner.query<{ plan_code: string; months: number }>(
    `SELECT plan_code, ((extract(year FROM age(period_end, period_start)) * 12) + extract(month FROM age(period_end, period_start)))::int AS months
     FROM app.subscriptions WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}

describe('scenarios', () => {
  it('stop at the free plan limit (Tabla 13: 2 saved scenarios)', async () => {
    const user = await createUser(db);
    expect(await createScenario(user)).toBe('created');
    expect(await createScenario(user)).toBe('created');
    expect(await createScenario(user)).toBe('limit_reached');
  });

  it('are unlimited while a paid plan is in force (the limit is read from the database)', async () => {
    const user = await createUser(db);
    await settle(await order(user), user, 'authorized', PAID_PRICE);
    const results = await Promise.all(Array.from({ length: 4 }, () => createScenario(user)));
    expect(results).toEqual(['created', 'created', 'created', 'created']);
  });

  it('cannot exceed the limit with concurrent requests', async () => {
    const user = await createUser(db);
    const results = await Promise.all(Array.from({ length: 6 }, () => createScenario(user)));
    expect(results.filter((result) => result === 'created')).toHaveLength(2);
    const { rows } = await db.owner.query<{ n: string }>('SELECT count(*) AS n FROM app.scenarios WHERE owner_id = $1', [user]);
    expect(rows[0]?.n).toBe('2');
  });

  it('store decisions only, never a copy of the base state (rule 3)', async () => {
    const { rows } = await db.owner.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'scenarios' ORDER BY ordinal_position`,
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      'id', 'owner_id', 'name', 'base_kind', 'household_id', 'decisions', 'created_at', 'updated_at',
    ]);
  });

  it('reject decision lists that are not arrays or are too long', async () => {
    const user = await createUser(db);
    await createScenario(user);
    const update = (decisions: string): Promise<unknown> =>
      asUser(db.api, user, (c) => c.query('UPDATE app.scenarios SET decisions = $1::jsonb', [decisions]));
    expect(await errorCode(update('{"kind":"one_off_expense"}'))).toBe('23514');
    expect(await errorCode(update(JSON.stringify(Array.from({ length: 21 }, () => ({}))))))
      .toBe('23514');
  });
});

describe('payments', () => {
  it('activate a plan exactly once for repeated confirmations (RNF04)', async () => {
    const user = await createUser(db);
    const buyOrder = await order(user);
    expect(await settle(buyOrder, user, 'authorized', PAID_PRICE)).toBe('activated');
    expect(await settle(buyOrder, user, 'authorized', PAID_PRICE)).toBe('already_activated');
    expect(await subscription(user)).toEqual({ plan_code: 'paid', months: 1 });
  });

  it('give one period per payment even when two first payments settle concurrently', async () => {
    const user = await createUser(db);
    const [first, second] = [await order(user), await order(user)];
    const results = await Promise.all([
      settle(first, user, 'authorized', PAID_PRICE),
      settle(second, user, 'authorized', PAID_PRICE),
    ]);
    expect(results).toEqual(['activated', 'activated']);
    expect(await subscription(user)).toEqual({ plan_code: 'paid', months: 2 });
  });

  it('extend the current period when the same plan is renewed', async () => {
    const user = await createUser(db);
    await settle(await order(user), user, 'authorized', PAID_PRICE);
    await settle(await order(user), user, 'authorized', PAID_PRICE);
    expect(await subscription(user)).toEqual({ plan_code: 'paid', months: 2 });
  });

  it('start a new period on a plan change instead of upgrading the remaining time for free', async () => {
    const user = await createUser(db);
    await settle(await order(user), user, 'authorized', PAID_PRICE);
    await settle(await order(user, 'family', FAMILY_PRICE), user, 'authorized', FAMILY_PRICE);
    expect(await subscription(user)).toEqual({ plan_code: 'family', months: 1 });
  });

  it('flag a confirmed amount that differs from the order for reconciliation (HU26)', async () => {
    const user = await createUser(db);
    const buyOrder = await order(user);
    expect(await settle(buyOrder, user, 'authorized', 1)).toBe('amount_mismatch');
    expect(await settle(buyOrder, user, 'authorized', PAID_PRICE)).toBe('already_settled');
    expect(await subscription(user)).toBeUndefined();
    const { rows } = await db.admin.query<{ status: string; authorized_amount: string }>(
      'SELECT status, authorized_amount FROM app.payment_orders WHERE buy_order = $1',
      [buyOrder],
    );
    expect(rows[0]).toEqual({ status: 'amount_mismatch', authorized_amount: '1' });
  });

  it('record rejected and aborted payments without activating', async () => {
    const user = await createUser(db);
    expect(await settle(await order(user), user, 'rejected', PAID_PRICE)).toBe('rejected');
    expect(await settle(await order(user), user, 'aborted', 0)).toBe('aborted');
    expect(await subscription(user)).toBeUndefined();
  });

  it('do not settle an order on behalf of another user', async () => {
    const owner = await createUser(db);
    const other = await createUser(db);
    const buyOrder = await order(owner);
    expect(await settle(buyOrder, other, 'authorized', PAID_PRICE)).toBe('unknown_order');
    expect(await settle('FDMdoesnotexist', owner, 'authorized', PAID_PRICE)).toBe('unknown_order');
  });

  it('only accept new orders at the current plan price and without outcomes', async () => {
    const user = await createUser(db);
    const other = await createUser(db);
    const attempts = [
      // Another user's order.
      [`INSERT INTO app.payment_orders (buy_order, user_id, plan_code, amount) VALUES ('FDMa1', $1, 'paid', ${String(PAID_PRICE)})`, other],
      // Wrong amount.
      [`INSERT INTO app.payment_orders (buy_order, user_id, plan_code, amount) VALUES ('FDMa2', $1, 'paid', 1)`, user],
      // Pre-activated.
      [`INSERT INTO app.payment_orders (buy_order, user_id, plan_code, amount, status) VALUES ('FDMa3', $1, 'paid', ${String(PAID_PRICE)}, 'authorized')`, user],
      // Provider token or commit time set by the client.
      [`INSERT INTO app.payment_orders (buy_order, user_id, plan_code, amount, provider_token) VALUES ('FDMa4', $1, 'paid', ${String(PAID_PRICE)}, 'tok')`, user],
      [`INSERT INTO app.payment_orders (buy_order, user_id, plan_code, amount, committed_at) VALUES ('FDMa5', $1, 'paid', ${String(PAID_PRICE)}, now())`, user],
    ] as const;
    for (const [sql, owner] of attempts) {
      expect(await errorCode(asUser(db.api, user, (c) => c.query(sql, [owner]))), sql).toBe('42501');
    }
  });

  it('do not sell plans without a price', async () => {
    const user = await createUser(db);
    await db.owner.query(`UPDATE app.plans SET price_clp = NULL WHERE code = 'family'`);
    try {
      expect(await errorCode(order(user, 'family', FAMILY_PRICE))).toBe('42501');
    } finally {
      await db.owner.query(`UPDATE app.plans SET price_clp = $1 WHERE code = 'family'`, [FAMILY_PRICE]);
    }
  });

  it('let the API store the provider token of a pending order once', async () => {
    const user = await createUser(db);
    const buyOrder = await order(user);
    const store = (token: string): Promise<{ rowCount: number | null }> =>
      asUser(db.api, user, (c) =>
        c.query('UPDATE app.payment_orders SET provider_token = $1 WHERE buy_order = $2', [token, buyOrder]),
      );
    expect((await store('tok-1')).rowCount).toBe(1);
    expect((await store('tok-2')).rowCount).toBe(0);
  });

  it('do not let users write subscriptions directly', async () => {
    const user = await createUser(db);
    const code = await errorCode(
      asUser(db.api, user, (c) =>
        c.query(`INSERT INTO app.subscriptions (user_id, plan_code, period_start, period_end) VALUES ($1, 'paid', current_date, current_date + 365)`, [
          user,
        ]),
      ),
    );
    expect(code).toBe('42501');
  });

  it('let the user cancel the renewal while keeping access until the period ends (Tabla 14)', async () => {
    const user = await createUser(db);
    await settle(await order(user), user, 'authorized', PAID_PRICE);
    const { rows } = await asUser(db.api, user, (c) => c.query<{ ok: boolean | null }>('SELECT app.cancel_subscription() AS ok'));
    expect(rows[0]?.ok).toBe(true);
    const sub = await db.owner.query<{ cancel_at_period_end: boolean }>(
      'SELECT cancel_at_period_end FROM app.subscriptions WHERE user_id = $1',
      [user],
    );
    expect(sub.rows[0]?.cancel_at_period_end).toBe(true);
    // Access continues: the paid plan still lifts the scenario limit.
    expect(await Promise.all([createScenario(user), createScenario(user), createScenario(user)])).toEqual([
      'created',
      'created',
      'created',
    ]);
  });

  it('store no card data (rule 6, RNF09)', async () => {
    const { rows } = await db.owner.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND column_name ~ '(card|pan|cvv|cvc)'`,
    );
    expect(rows).toEqual([]);
  });
});
