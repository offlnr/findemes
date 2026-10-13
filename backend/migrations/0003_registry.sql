-- Financial registry of each user (HU01-HU04). Strictly individual: only the owner can read or
-- write these rows (rule 5, RNF08). Amounts are integer CLP (rule 10).

-- HU04: opening balance, positive or negative, at the start of a month.
CREATE TABLE app.financial_profiles (
  owner_id        uuid PRIMARY KEY REFERENCES app.users (id) ON DELETE CASCADE,
  opening_balance app.clp NOT NULL,
  balance_month   app.month NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- HU01. Schedule matches the core's `Schedule`: once (one month), monthly, or every N months
-- anchored at `from_month`. `until_month` NULL means no end.
CREATE TABLE app.incomes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  label           app.label NOT NULL,
  amount          app.clp NOT NULL CHECK (amount > 0),
  schedule_kind   text NOT NULL CHECK (schedule_kind IN ('once', 'monthly', 'every_n_months')),
  interval_months smallint,
  from_month      app.month NOT NULL,
  until_month     app.month,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (schedule_kind = 'once' AND interval_months IS NULL AND until_month IS NULL)
    OR (schedule_kind = 'monthly' AND interval_months IS NULL)
    OR (schedule_kind = 'every_n_months' AND interval_months BETWEEN 2 AND 24)
  ),
  CHECK (until_month IS NULL OR until_month >= from_month)
);
CREATE INDEX incomes_owner_idx ON app.incomes (owner_id);

-- HU02: fixed recurring expenses and estimated variable expenses.
CREATE TABLE app.expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  label           app.label NOT NULL,
  nature          text NOT NULL CHECK (nature IN ('fixed', 'variable_estimate')),
  amount          app.clp NOT NULL CHECK (amount > 0),
  schedule_kind   text NOT NULL CHECK (schedule_kind IN ('once', 'monthly', 'every_n_months')),
  interval_months smallint,
  from_month      app.month NOT NULL,
  until_month     app.month,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (schedule_kind = 'once' AND interval_months IS NULL AND until_month IS NULL)
    OR (schedule_kind = 'monthly' AND interval_months IS NULL)
    OR (schedule_kind = 'every_n_months' AND interval_months BETWEEN 2 AND 24)
  ),
  CHECK (until_month IS NULL OR until_month >= from_month)
);
CREATE INDEX expenses_owner_idx ON app.expenses (owner_id);

-- HU03: a debt is its explicit schedule of pending installments (one row per month), which
-- also represents unequal installments. The registry expands the HU03 input into these rows.
CREATE TABLE app.debts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  label              app.label NOT NULL,
  -- HU03 input kept to show progress ("cuota 3 de 12"); the schedule holds what is pending.
  total_installments smallint CHECK (total_installments BETWEEN 1 AND 600),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);
CREATE INDEX debts_owner_idx ON app.debts (owner_id);

CREATE TABLE app.debt_installments (
  debt_id  uuid NOT NULL,
  owner_id uuid NOT NULL,
  month    app.month NOT NULL,
  amount   app.clp NOT NULL CHECK (amount > 0),
  PRIMARY KEY (debt_id, month),
  -- The composite key keeps an installment owned by the owner of its debt.
  FOREIGN KEY (debt_id, owner_id) REFERENCES app.debts (id, owner_id) ON DELETE CASCADE
);
CREATE INDEX debt_installments_owner_idx ON app.debt_installments (owner_id);

ALTER TABLE app.financial_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.incomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.debt_installments ENABLE ROW LEVEL SECURITY;

CREATE POLICY financial_profiles_owner ON app.financial_profiles TO app_api
  USING (owner_id = app.current_user_id()) WITH CHECK (owner_id = app.current_user_id());
CREATE POLICY incomes_owner ON app.incomes TO app_api
  USING (owner_id = app.current_user_id()) WITH CHECK (owner_id = app.current_user_id());
CREATE POLICY expenses_owner ON app.expenses TO app_api
  USING (owner_id = app.current_user_id()) WITH CHECK (owner_id = app.current_user_id());
CREATE POLICY debts_owner ON app.debts TO app_api
  USING (owner_id = app.current_user_id()) WITH CHECK (owner_id = app.current_user_id());
CREATE POLICY debt_installments_owner ON app.debt_installments TO app_api
  USING (owner_id = app.current_user_id()) WITH CHECK (owner_id = app.current_user_id());

-- Only the public API touches financial data. app_admin receives no grant at all (HU23).
GRANT SELECT, INSERT, UPDATE, DELETE
  ON app.financial_profiles, app.incomes, app.expenses, app.debts, app.debt_installments
  TO app_api;
