-- Bank aggregation (HU36, ADR-002): Fintoc test mode or the demo bank. Individual data, owner only.

CREATE TABLE app.bank_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('fintoc', 'demo')),
  provider_link_id  text NOT NULL CHECK (length(provider_link_id) BETWEEN 1 AND 128),
  institution_name  text NOT NULL CHECK (length(institution_name) BETWEEN 1 AND 120),
  -- link_token encrypted by the application with AES-256-GCM; the database never sees it in clear.
  token_ciphertext  bytea NOT NULL,
  token_nonce       bytea NOT NULL CHECK (length(token_nonce) = 12),
  token_key_version smallint NOT NULL CHECK (token_key_version > 0),
  origin            text NOT NULL CHECK (origin IN ('real', 'provider_test', 'demo')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_synced_at    timestamptz,
  -- Reconnecting the same bank updates the existing link (observed in the Fintoc spike).
  UNIQUE (owner_id, provider, provider_link_id),
  UNIQUE (id, owner_id)
);

CREATE TABLE app.bank_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL,
  link_id           uuid NOT NULL,
  external_id       text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 128),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  account_type      text NOT NULL CHECK (length(account_type) BETWEEN 1 AND 40),
  available_balance app.clp NOT NULL,
  origin            text NOT NULL CHECK (origin IN ('real', 'provider_test', 'demo')),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (link_id, external_id),
  UNIQUE (id, owner_id),
  FOREIGN KEY (link_id, owner_id) REFERENCES app.bank_links (id, owner_id) ON DELETE CASCADE
);

CREATE TABLE app.bank_movements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL,
  account_id  uuid NOT NULL,
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 128),
  posted_on   date NOT NULL,
  -- Negative for a debit (cargo), positive for a credit (abono).
  amount      app.clp NOT NULL CHECK (amount <> 0),
  -- Bank-provided text: untrusted, always escaped when shown.
  description text NOT NULL CHECK (length(description) <= 500),
  origin      text NOT NULL CHECK (origin IN ('real', 'provider_test', 'demo')),
  imported_at timestamptz NOT NULL DEFAULT now(),
  -- Re-syncing is idempotent: the same provider movement is stored once.
  UNIQUE (account_id, external_id),
  UNIQUE (id, owner_id),
  FOREIGN KEY (account_id, owner_id) REFERENCES app.bank_accounts (id, owner_id) ON DELETE CASCADE
);
CREATE INDEX bank_movements_owner_month_idx ON app.bank_movements (owner_id, posted_on);

ALTER TABLE app.bank_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.bank_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_links_owner ON app.bank_links TO app_api
  USING (owner_id = app.current_user_id()) WITH CHECK (owner_id = app.current_user_id());
CREATE POLICY bank_accounts_owner ON app.bank_accounts TO app_api
  USING (owner_id = app.current_user_id()) WITH CHECK (owner_id = app.current_user_id());
CREATE POLICY bank_movements_owner ON app.bank_movements TO app_api
  USING (owner_id = app.current_user_id()) WITH CHECK (owner_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.bank_links, app.bank_accounts, app.bank_movements TO app_api;

-- Registry entries can come from the bank (HU36): the user confirms which movements are recurring
-- and the opening balance can be taken from an account. The origin travels with the entry so
-- demo or test data is always labelled (ADR-002); the source link is cleared if the bank data is
-- deleted, while the confirmed entry stays.
ALTER TABLE app.financial_profiles
  ADD COLUMN origin text NOT NULL DEFAULT 'real' CHECK (origin IN ('real', 'provider_test', 'demo')),
  ADD COLUMN source_account_id uuid,
  ADD FOREIGN KEY (source_account_id, owner_id)
    REFERENCES app.bank_accounts (id, owner_id) ON DELETE SET NULL (source_account_id);

ALTER TABLE app.incomes
  ADD COLUMN origin text NOT NULL DEFAULT 'real' CHECK (origin IN ('real', 'provider_test', 'demo')),
  ADD COLUMN source_movement_id uuid,
  ADD FOREIGN KEY (source_movement_id, owner_id)
    REFERENCES app.bank_movements (id, owner_id) ON DELETE SET NULL (source_movement_id);

ALTER TABLE app.expenses
  ADD COLUMN origin text NOT NULL DEFAULT 'real' CHECK (origin IN ('real', 'provider_test', 'demo')),
  ADD COLUMN source_movement_id uuid,
  ADD FOREIGN KEY (source_movement_id, owner_id)
    REFERENCES app.bank_movements (id, owner_id) ON DELETE SET NULL (source_movement_id);
