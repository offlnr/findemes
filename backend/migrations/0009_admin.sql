-- Platform administrators (HU22, RNF22). An administrator is a registered user with this role and
-- a TOTP second factor. A user without a row here is denied by the admin API even with a valid
-- session. Only the admin service role can read this table.

CREATE TABLE app.platform_admins (
  user_id               uuid PRIMARY KEY REFERENCES app.users (id) ON DELETE CASCADE,
  -- TOTP secret encrypted by the application with AES-256-GCM.
  totp_secret_ciphertext bytea NOT NULL,
  totp_nonce            bytea NOT NULL CHECK (length(totp_nonce) = 12),
  totp_key_version      smallint NOT NULL CHECK (totp_key_version > 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_login_at         timestamptz
);

GRANT SELECT ON app.platform_admins TO app_admin;
GRANT UPDATE (last_login_at) ON app.platform_admins TO app_admin;

-- Admin login: password hash and TOTP material for administrators only. The admin role cannot
-- read the password hash of ordinary users (column grants in 0002).
CREATE FUNCTION app.lookup_admin_login(p_email text)
  RETURNS TABLE (
    user_id uuid, password_hash text, status text,
    totp_secret_ciphertext bytea, totp_nonce bytea, totp_key_version smallint
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
    SELECT u.id, u.password_hash, u.status, a.totp_secret_ciphertext, a.totp_nonce, a.totp_key_version
    FROM app.users u
    JOIN app.platform_admins a ON a.user_id = u.id
    WHERE u.email = lower(btrim(p_email))
  $$;

GRANT EXECUTE ON FUNCTION app.lookup_admin_login(text) TO app_admin;
