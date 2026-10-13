-- Foundation: schema, service roles, shared domains and security helpers.
--
-- Roles (CLAUDE.md, Seguridad):
--   * The migration owner (the role running this file) owns every object. No service connects
--     with it, so Row-Level Security always applies to the services.
--   * app_api   -> group role of the public API. Reads and writes user data under RLS.
--   * app_admin -> group role of the admin API. Never reads financial tables (HU23).
-- Login roles with passwords are created per environment and granted one of these groups.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_api, app_admin;

-- Functions are executable by PUBLIC by default. A per-schema ALTER DEFAULT PRIVILEGES cannot
-- remove that default, so it is revoked globally for the owner's future functions; every grant
-- in the migrations is explicit. A test checks the resulting EXECUTE privileges.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Integer CLP within JavaScript's safe integer range (rule 10).
CREATE DOMAIN app.clp AS bigint
  CHECK (VALUE BETWEEN -9007199254740991 AND 9007199254740991);

-- Calendar month, stored as its first day.
CREATE DOMAIN app.month AS date
  CHECK (VALUE = date_trunc('month', VALUE)::date);

-- User-given names shown in the app and in explanations.
CREATE DOMAIN app.label AS text
  CHECK (length(btrim(VALUE)) BETWEEN 1 AND 80);

-- Authenticated user of the current transaction. The API sets it with
-- set_config('app.user_id', <uuid>, true) inside each transaction; unset means no user,
-- which makes every owner policy match nothing (deny by default).
CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

GRANT EXECUTE ON FUNCTION app.current_user_id() TO app_api, app_admin;

-- Today's date in Chile. Plan validity and billing periods use it, never the session TimeZone
-- (DigitalOcean servers run in UTC).
CREATE FUNCTION app.today_cl() RETURNS date
  LANGUAGE sql STABLE
  AS $$ SELECT (now() AT TIME ZONE 'America/Santiago')::date $$;
