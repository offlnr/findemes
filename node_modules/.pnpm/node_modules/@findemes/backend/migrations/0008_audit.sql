-- Audit trail (RNF10, RNF22, HU25): append-only and hash-chained. Each entry stores the hash of
-- the previous one, so altering or removing a past entry breaks the chain and is detectable.
-- After an account is erased (HU21) its entries keep only the pseudonymous user id.

CREATE TABLE app.audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Chain position, assigned under a lock by the trigger (ids may commit out of order).
  seq         bigint NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL,
  actor_type  text NOT NULL CHECK (actor_type IN ('user', 'admin', 'system')),
  actor_id    uuid,
  action      text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]{0,63}$'),
  target_type text NOT NULL CHECK (target_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  target_id   uuid,
  -- HU25 "origen": client IP as seen by the API.
  origin_ip   inet,
  -- Never personal or financial values: identifiers and field names only.
  details     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 4096),
  prev_hash   bytea NOT NULL CHECK (length(prev_hash) = 32),
  hash        bytea NOT NULL UNIQUE CHECK (length(hash) = 32)
);

CREATE FUNCTION app.audit_entry_hash(e app.audit_log) RETURNS bytea
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, app
  AS $$
    SELECT sha256(e.prev_hash || convert_to(concat_ws('|',
      -- Epoch microseconds: independent of the session's TimeZone setting.
      e.seq::text, (extract(epoch FROM e.occurred_at) * 1000000)::bigint::text, e.actor_type, coalesce(e.actor_id::text, ''), e.action,
      e.target_type, coalesce(e.target_id::text, ''), coalesce(host(e.origin_ip), ''), e.details::text
    ), 'UTF8'))
  $$;

-- Fills in the server time and the chain fields; callers cannot choose them.
CREATE FUNCTION app.audit_chain() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  DECLARE
    last_entry record;
  BEGIN
    -- Each service may only record its own kind of actor: the public API cannot write entries
    -- that look like administrator actions, and vice versa. session_user is the login role.
    IF pg_has_role(session_user, 'app_api', 'MEMBER') AND NEW.actor_type NOT IN ('user', 'system') THEN
      RAISE EXCEPTION 'the public API cannot record % actions', NEW.actor_type USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF pg_has_role(session_user, 'app_admin', 'MEMBER') AND NEW.actor_type NOT IN ('admin', 'system') THEN
      RAISE EXCEPTION 'the admin API cannot record % actions', NEW.actor_type USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Details hold identifiers and field names only, never personal or financial values.
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(NEW.details) k
               WHERE k ~* '^(email|password|token|secret|amount|balance|rut|phone|full_name|address)$') THEN
      RAISE EXCEPTION 'audit details must not contain personal or financial values' USING ERRCODE = 'check_violation';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('app.audit_log', 0));
    SELECT a.seq, a.hash INTO last_entry FROM app.audit_log a ORDER BY a.seq DESC LIMIT 1;
    NEW.seq := coalesce(last_entry.seq, 0) + 1;
    NEW.occurred_at := now();
    NEW.prev_hash := coalesce(last_entry.hash, '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea);
    NEW.hash := app.audit_entry_hash(NEW);
    RETURN NEW;
  END
  $$;
CREATE TRIGGER audit_log_chain BEFORE INSERT ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_chain();

CREATE FUNCTION app.audit_reject_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'the audit trail is append-only' USING ERRCODE = 'insufficient_privilege';
  END
  $$;
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_reject_change();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON app.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.audit_reject_change();

-- Returns the seq of the first entry whose hash or link does not match, or NULL if intact.
CREATE FUNCTION app.verify_audit_chain() RETURNS bigint
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  DECLARE
    entry app.audit_log%ROWTYPE;
    expected_prev bytea := '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea;
    expected_seq bigint := 1;
  BEGIN
    FOR entry IN SELECT * FROM app.audit_log ORDER BY seq LOOP
      IF entry.seq <> expected_seq OR entry.prev_hash <> expected_prev OR entry.hash <> app.audit_entry_hash(entry) THEN
        RETURN entry.seq;
      END IF;
      expected_prev := entry.hash;
      expected_seq := expected_seq + 1;
    END LOOP;
    RETURN NULL;
  END
  $$;

-- The public API can only append. Administrators can read and append (their own actions,
-- RNF22) but never alter the trail (HU25).
GRANT INSERT ON app.audit_log TO app_api, app_admin;
GRANT SELECT ON app.audit_log TO app_admin;
GRANT EXECUTE ON FUNCTION app.verify_audit_chain() TO app_admin;
