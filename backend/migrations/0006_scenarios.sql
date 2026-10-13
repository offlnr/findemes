-- Scenarios (HU06, HU07, HU09, HU11). A scenario stores its name, a reference to its base state
-- and its decisions only. The base state is never copied, so a scenario cannot alter it (rule 3).

CREATE TABLE app.scenarios (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  name         app.label NOT NULL,
  base_kind    text NOT NULL CHECK (base_kind IN ('personal', 'household')),
  -- A shared-space action never deletes individual data (rule 5): see the detach triggers below.
  household_id uuid REFERENCES app.households (id),
  -- Raw decisions as received; the core's parseParams validates them at simulation time.
  decisions    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(decisions) = 'array'
    AND jsonb_array_length(decisions) <= 20
    AND octet_length(decisions::text) <= 65536
  ),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((base_kind = 'household') = (household_id IS NOT NULL))
);
CREATE INDEX scenarios_owner_idx ON app.scenarios (owner_id);
CREATE INDEX scenarios_household_idx ON app.scenarios (household_id);

ALTER TABLE app.scenarios ENABLE ROW LEVEL SECURITY;

-- Scenarios are individual even when derived from the household state (rule 5).
CREATE POLICY scenarios_owner ON app.scenarios TO app_api
  USING (owner_id = app.current_user_id())
  WITH CHECK (
    owner_id = app.current_user_id()
    AND (household_id IS NULL OR app.is_household_member(household_id))
  );

-- New scenarios only through create_scenario_if_under_limit, so the plan limit always applies.
GRANT SELECT, DELETE ON app.scenarios TO app_api;
GRANT UPDATE (name, base_kind, household_id, decisions, updated_at) ON app.scenarios TO app_api;

-- Plan in force for a user today (Chile): the paid plan while its period lasts, otherwise free.
-- HU20: an expired plan falls back to free without losing data.
CREATE FUNCTION app.effective_plan(p_user_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
    SELECT coalesce(
      (SELECT s.plan_code FROM app.subscriptions s
        WHERE s.user_id = p_user_id AND s.period_start <= app.today_cl() AND s.period_end > app.today_cl()),
      'free')
  $$;

-- Creates a scenario for the current user only while they are under their plan's limit
-- (Tabla 13). The limit is read here, not supplied by the caller, and a per-user transaction lock
-- serializes concurrent requests so it cannot be exceeded.
CREATE FUNCTION app.create_scenario_if_under_limit(
  p_id uuid, p_name text, p_base_kind text, p_household_id uuid, p_decisions jsonb
) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  DECLARE
    actor uuid := app.current_user_id();
    max_scenarios integer;
  BEGIN
    IF actor IS NULL THEN
      RAISE EXCEPTION 'no authenticated user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_household_id IS NOT NULL AND NOT app.is_household_member(p_household_id) THEN
      RAISE EXCEPTION 'not a member of that household' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('app.scenarios:' || actor::text, 0));
    SELECT p.max_saved_scenarios INTO max_scenarios FROM app.plans p WHERE p.code = app.effective_plan(actor);
    IF max_scenarios IS NOT NULL
       AND (SELECT count(*) FROM app.scenarios s WHERE s.owner_id = actor) >= max_scenarios THEN
      RETURN 'limit_reached';
    END IF;
    INSERT INTO app.scenarios (id, owner_id, name, base_kind, household_id, decisions)
      VALUES (p_id, actor, p_name, p_base_kind, p_household_id, p_decisions);
    RETURN 'created';
  END
  $$;

-- Rule 5: when a household disappears, or a member leaves it, that member's scenarios based on
-- it become personal scenarios instead of being deleted.
CREATE FUNCTION app.detach_scenarios_from_household() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  BEGIN
    IF TG_TABLE_NAME = 'households' THEN
      UPDATE app.scenarios s SET base_kind = 'personal', household_id = NULL, updated_at = now()
       WHERE s.household_id = OLD.id;
    ELSE
      UPDATE app.scenarios s SET base_kind = 'personal', household_id = NULL, updated_at = now()
       WHERE s.household_id = OLD.household_id AND s.owner_id = OLD.user_id;
    END IF;
    RETURN OLD;
  END
  $$;
CREATE TRIGGER households_detach_scenarios BEFORE DELETE ON app.households
  FOR EACH ROW EXECUTE FUNCTION app.detach_scenarios_from_household();
CREATE TRIGGER household_members_detach_scenarios AFTER DELETE ON app.household_members
  FOR EACH ROW EXECUTE FUNCTION app.detach_scenarios_from_household();

GRANT EXECUTE ON FUNCTION app.create_scenario_if_under_limit(uuid, text, text, uuid, jsonb) TO app_api;
