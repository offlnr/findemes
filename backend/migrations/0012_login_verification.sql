-- Email code at sign-in (CU-11): after the password is accepted, a 6-digit code is required when
-- the device is not recognized, after a password reset, or 30 days after the last verification
-- on that device. The API decides when to ask; the database keeps the codes and the devices.

-- Recognized devices. device_hash is the SHA-256 of a random identifier kept by the client
-- (HttpOnly cookie on the web, flutter_secure_storage on mobile); the identifier itself is never
-- stored. "Close all sessions" and a password reset delete the user's rows.
CREATE TABLE app.trusted_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  device_hash bytea NOT NULL CHECK (length(device_hash) = 32),
  created_at  timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_hash)
);

-- Pending sign-in codes. code_hash is an HMAC of the code keyed with a server secret, so a
-- leaked row cannot be brute-forced over the 10^6 possible codes. Valid 10 minutes, single
-- use, at most 5 attempts.
CREATE TABLE app.login_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  device_hash bytea NOT NULL CHECK (length(device_hash) = 32),
  code_hash   bytea NOT NULL CHECK (length(code_hash) = 32),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  used_at     timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);
CREATE INDEX login_codes_user_idx ON app.login_codes (user_id);

ALTER TABLE app.trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.login_codes ENABLE ROW LEVEL SECURITY;

-- The API issues a code and manages devices only after the password check, inside the user's
-- context. Checking the code happens before the user is known, through consume_login_code.
CREATE POLICY trusted_devices_self ON app.trusted_devices TO app_api
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
CREATE POLICY login_codes_self ON app.login_codes TO app_api
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());

GRANT SELECT, INSERT, DELETE ON app.trusted_devices TO app_api;
GRANT UPDATE (verified_at) ON app.trusted_devices TO app_api;
GRANT SELECT, INSERT, DELETE ON app.login_codes TO app_api;

-- Checks a code for a pending challenge and returns its user, or NULL when the challenge is
-- unknown, used, expired, out of attempts or the account is not active. A wrong code spends one
-- attempt. A right code marks the challenge used and recognizes the device for 30 days.
CREATE FUNCTION app.consume_login_code(p_challenge_id uuid, p_code_hash bytea) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  DECLARE
    challenge app.login_codes%ROWTYPE;
    account_status text;
  BEGIN
    SELECT * INTO challenge FROM app.login_codes c WHERE c.id = p_challenge_id FOR UPDATE;
    IF NOT FOUND OR challenge.used_at IS NOT NULL OR challenge.expires_at <= now()
       OR challenge.attempts >= 5 THEN
      RETURN NULL;
    END IF;

    IF challenge.code_hash IS DISTINCT FROM p_code_hash THEN
      UPDATE app.login_codes c SET attempts = c.attempts + 1 WHERE c.id = challenge.id;
      RETURN NULL;
    END IF;

    SELECT u.status INTO account_status FROM app.users u WHERE u.id = challenge.user_id;
    IF account_status IS DISTINCT FROM 'active' THEN
      RETURN NULL;
    END IF;

    UPDATE app.login_codes c SET used_at = now() WHERE c.id = challenge.id;
    INSERT INTO app.trusted_devices (user_id, device_hash)
      VALUES (challenge.user_id, challenge.device_hash)
      ON CONFLICT (user_id, device_hash) DO UPDATE SET verified_at = now();
    RETURN challenge.user_id;
  END
  $$;

GRANT EXECUTE ON FUNCTION app.consume_login_code(uuid, bytea) TO app_api;
