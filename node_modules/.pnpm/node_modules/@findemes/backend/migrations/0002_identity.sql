-- Identity (HU17, HU17.1-HU17.4, HU23).

CREATE TABLE app.users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored normalized by the application (trimmed, lower case).
  email             text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
  -- argon2id hash, never the password (RNF07).
  password_hash     text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  email_verified_at timestamptz,
  -- HU23: an administrator can suspend and reactivate an account.
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON app.users (email);

-- Opaque rotating refresh tokens, stored as SHA-256 hashes. A family groups the tokens of one
-- login; reusing a consumed token revokes the whole family.
CREATE TABLE app.refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  bytea NOT NULL UNIQUE CHECK (length(token_hash) = 32),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at  timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX refresh_tokens_user_idx ON app.refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON app.refresh_tokens (family_id);

-- Single-use links sent by email, stored as SHA-256 hashes (verification 24 h, reset 30 min).
CREATE TABLE app.email_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash bytea NOT NULL UNIQUE CHECK (length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX email_tokens_user_idx ON app.email_tokens (user_id);

-- HU17.1: growing lockout per account plus a per-IP limit. Keys are HMACs of the normalized
-- email or of the IP, so the table holds no personal data in clear.
CREATE TABLE app.login_throttle (
  key_hash     bytea PRIMARY KEY CHECK (length(key_hash) = 32),
  failures     integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Row-Level Security: a user only ever sees their own account.
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self ON app.users TO app_api
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());
-- HU23: administrators list and suspend accounts; column grants hide the password hash.
CREATE POLICY users_admin ON app.users TO app_admin USING (true) WITH CHECK (true);

CREATE POLICY refresh_tokens_self ON app.refresh_tokens TO app_api
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

CREATE POLICY email_tokens_self ON app.email_tokens TO app_api
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

-- The API cannot change an account's status (only administrators suspend or reactivate) nor
-- mark an email as verified (only consume_email_token does, with a valid single-use token).
GRANT SELECT, INSERT, DELETE ON app.users TO app_api;
GRANT UPDATE (email, password_hash, updated_at) ON app.users TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.refresh_tokens, app.email_tokens, app.login_throttle TO app_api;

GRANT SELECT (id, email, email_verified_at, status, created_at, updated_at) ON app.users TO app_admin;
GRANT UPDATE (status, updated_at) ON app.users TO app_admin;

-- Login happens before the user is known, so RLS would hide the account. This function returns
-- only what credential verification needs, for one exact email.
CREATE FUNCTION app.lookup_login(p_email text)
  RETURNS TABLE (user_id uuid, password_hash text, email_verified_at timestamptz, status text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
    SELECT u.id, u.password_hash, u.email_verified_at, u.status
    FROM app.users u
    WHERE u.email = lower(btrim(p_email))
  $$;

-- Atomic refresh-token rotation (HU17.2, HU17.3). Consumes the presented token and stores its
-- successor in the same family. Presenting an already consumed token means it leaked: the whole
-- family is revoked and 'reused' is returned.
CREATE FUNCTION app.rotate_refresh_token(p_old_hash bytea, p_new_hash bytea, p_expires_at timestamptz)
  RETURNS TABLE (result text, result_user_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  DECLARE
    current_token app.refresh_tokens%ROWTYPE;
    account_status text;
  BEGIN
    SELECT * INTO current_token FROM app.refresh_tokens t WHERE t.token_hash = p_old_hash FOR UPDATE;
    IF NOT FOUND OR current_token.revoked_at IS NOT NULL OR current_token.expires_at <= now() THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid;
      RETURN;
    END IF;

    IF current_token.consumed_at IS NOT NULL THEN
      UPDATE app.refresh_tokens t SET revoked_at = now()
        WHERE t.family_id = current_token.family_id AND t.revoked_at IS NULL;
      RETURN QUERY SELECT 'reused'::text, NULL::uuid;
      RETURN;
    END IF;

    SELECT u.status INTO account_status FROM app.users u WHERE u.id = current_token.user_id;
    IF account_status IS DISTINCT FROM 'active' THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid;
      RETURN;
    END IF;

    UPDATE app.refresh_tokens t SET consumed_at = now() WHERE t.id = current_token.id;
    INSERT INTO app.refresh_tokens (user_id, family_id, token_hash, expires_at)
      VALUES (current_token.user_id, current_token.family_id, p_new_hash, p_expires_at);
    RETURN QUERY SELECT 'rotated'::text, current_token.user_id;
  END
  $$;

-- Consumes a single-use email token and returns its user, or NULL when it is unknown, used,
-- expired or for another purpose. A verification token also marks the email as verified.
CREATE FUNCTION app.consume_email_token(p_hash bytea, p_purpose text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  DECLARE
    owner uuid;
  BEGIN
    UPDATE app.email_tokens t
       SET used_at = now()
     WHERE t.token_hash = p_hash
       AND t.purpose = p_purpose
       AND t.used_at IS NULL
       AND t.expires_at > now()
    RETURNING t.user_id INTO owner;
    IF owner IS NOT NULL AND p_purpose = 'verify_email' THEN
      UPDATE app.users u SET email_verified_at = now(), updated_at = now()
       WHERE u.id = owner AND u.email_verified_at IS NULL;
    END IF;
    RETURN owner;
  END
  $$;

GRANT EXECUTE ON FUNCTION app.lookup_login(text) TO app_api;
GRANT EXECUTE ON FUNCTION app.rotate_refresh_token(bytea, bytea, timestamptz) TO app_api;
GRANT EXECUTE ON FUNCTION app.consume_email_token(bytea, text) TO app_api;
