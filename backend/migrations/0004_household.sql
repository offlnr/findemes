-- Household space (HU12-HU16, HU31). Information flows from the shared space to the members,
-- never the other way (rule 5): these tables hold only shared data. A member's individual
-- registry stays under the owner-only policies of 0003.

CREATE TABLE app.households (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       app.label NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.household_members (
  household_id uuid NOT NULL REFERENCES app.households (id) ON DELETE CASCADE,
  -- MVP: a user belongs to at most one household.
  user_id      uuid NOT NULL UNIQUE REFERENCES app.users (id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('admin', 'member')),
  -- Name shown to the other members; their email is never exposed.
  display_name app.label NOT NULL,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

-- HU12, HU31: single-use invitation links with limited validity, stored as SHA-256 hashes.
CREATE TABLE app.household_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES app.households (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE CHECK (length(token_hash) = 32),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  -- HU31 "vigencia limitada": at most 7 days.
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days')
);
CREATE INDEX household_invitations_household_idx ON app.household_invitations (household_id);

-- HU13: shared expenses, visible to every member together with who registered them.
CREATE TABLE app.household_expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES app.households (id) ON DELETE CASCADE,
  -- NULL once the author deletes their account (HU21).
  created_by      uuid REFERENCES app.users (id) ON DELETE SET NULL,
  -- HU13 "quién los registró": set by the server from the author's display name; it survives the
  -- author leaving and becomes 'Ex miembro' when the author's account is erased.
  created_by_name app.label NOT NULL,
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
  CHECK (until_month IS NULL OR until_month >= from_month),
  UNIQUE (id, household_id)
);
CREATE INDEX household_expenses_household_idx ON app.household_expenses (household_id);

CREATE FUNCTION app.household_expense_author() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      SELECT m.display_name INTO NEW.created_by_name FROM app.household_members m
       WHERE m.household_id = NEW.household_id AND m.user_id = NEW.created_by;
    ELSIF NEW.created_by IS NULL AND OLD.created_by IS NOT NULL THEN
      NEW.created_by_name := 'Ex miembro';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER household_expenses_author BEFORE INSERT OR UPDATE ON app.household_expenses
  FOR EACH ROW EXECUTE FUNCTION app.household_expense_author();

-- HU14: how each shared expense is split. `equal` splits among current members, `percentage`
-- uses contribution_shares (sum 100 %), `assigned` charges one member.
CREATE TABLE app.contribution_rules (
  expense_id       uuid PRIMARY KEY,
  household_id     uuid NOT NULL,
  mode             text NOT NULL CHECK (mode IN ('equal', 'percentage', 'assigned')),
  assigned_user_id uuid,
  CHECK ((mode = 'assigned') = (assigned_user_id IS NOT NULL)),
  UNIQUE (expense_id, household_id),
  FOREIGN KEY (expense_id, household_id) REFERENCES app.household_expenses (id, household_id) ON DELETE CASCADE
);

CREATE TABLE app.contribution_shares (
  expense_id   uuid NOT NULL,
  household_id uuid NOT NULL,
  user_id      uuid NOT NULL,
  -- Integer basis points (10 000 = 100 %).
  basis_points integer NOT NULL CHECK (basis_points BETWEEN 1 AND 10000),
  PRIMARY KEY (expense_id, user_id),
  -- The composite key keeps a share in the same household as its rule.
  FOREIGN KEY (expense_id, household_id) REFERENCES app.contribution_rules (expense_id, household_id) ON DELETE CASCADE
);

-- Membership helpers. SECURITY DEFINER avoids recursive RLS on household_members; they only
-- answer about the current user.
CREATE FUNCTION app.is_household_member(p_household_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.household_members m
      WHERE m.household_id = p_household_id AND m.user_id = app.current_user_id()
    )
  $$;

CREATE FUNCTION app.is_household_admin(p_household_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.household_members m
      WHERE m.household_id = p_household_id AND m.user_id = app.current_user_id() AND m.role = 'admin'
    )
  $$;

-- Rules and shares may only name current members of the same household.
CREATE FUNCTION app.require_household_member(p_household_id uuid, p_user_id uuid) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  BEGIN
    -- Non-admins are rejected by RLS afterwards; answering them here would reveal memberships.
    IF NOT app.is_household_admin(p_household_id) THEN
      RETURN;
    END IF;
    IF p_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM app.household_members m WHERE m.household_id = p_household_id AND m.user_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'contribution member must belong to the household' USING ERRCODE = 'check_violation';
    END IF;
  END
  $$;

CREATE FUNCTION app.check_rule_member() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  BEGIN
    PERFORM app.require_household_member(NEW.household_id, NEW.assigned_user_id);
    RETURN NEW;
  END
  $$;
CREATE TRIGGER contribution_rules_members BEFORE INSERT OR UPDATE ON app.contribution_rules
  FOR EACH ROW EXECUTE FUNCTION app.check_rule_member();

CREATE FUNCTION app.check_share_member() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  BEGIN
    PERFORM app.require_household_member(NEW.household_id, NEW.user_id);
    RETURN NEW;
  END
  $$;
CREATE TRIGGER contribution_shares_members BEFORE INSERT OR UPDATE ON app.contribution_shares
  FOR EACH ROW EXECUTE FUNCTION app.check_share_member();

-- HU14: percentages must add up to exactly 100 %, checked at commit so shares can be edited
-- together in one transaction.
CREATE FUNCTION app.check_percentage_total() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  DECLARE
    rule_id uuid;
    rule_mode text;
    total integer;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      rule_id := OLD.expense_id;
    ELSE
      rule_id := NEW.expense_id;
    END IF;
    SELECT r.mode INTO rule_mode FROM app.contribution_rules r WHERE r.expense_id = rule_id;
    SELECT coalesce(sum(s.basis_points), 0) INTO total FROM app.contribution_shares s WHERE s.expense_id = rule_id;
    IF rule_mode = 'percentage' AND total <> 10000 THEN
      RAISE EXCEPTION 'percentage shares must add up to 100 %%' USING ERRCODE = 'check_violation';
    END IF;
    IF rule_mode IS NOT NULL AND rule_mode <> 'percentage' AND total <> 0 THEN
      RAISE EXCEPTION 'only percentage rules have shares' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END
  $$;
CREATE CONSTRAINT TRIGGER contribution_rules_total AFTER INSERT OR UPDATE ON app.contribution_rules
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_percentage_total();
CREATE CONSTRAINT TRIGGER contribution_shares_total AFTER INSERT OR UPDATE OR DELETE ON app.contribution_shares
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.check_percentage_total();

-- When a member leaves or deletes their account (HU21): rules that named them fall back to an
-- equal split, an empty household is removed, and a household left without admin promotes its
-- longest-standing member.
CREATE FUNCTION app.after_member_removed() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  BEGIN
    -- The whole household is being deleted (cascade): nothing to rebalance.
    IF NOT EXISTS (SELECT 1 FROM app.households h WHERE h.id = OLD.household_id) THEN
      RETURN NULL;
    END IF;

    UPDATE app.contribution_rules r SET mode = 'equal', assigned_user_id = NULL
     WHERE r.household_id = OLD.household_id
       AND (r.assigned_user_id = OLD.user_id
            OR r.expense_id IN (SELECT s.expense_id FROM app.contribution_shares s WHERE s.user_id = OLD.user_id));
    DELETE FROM app.contribution_shares s
     WHERE s.household_id = OLD.household_id
       AND s.expense_id IN (SELECT r.expense_id FROM app.contribution_rules r
                             WHERE r.household_id = OLD.household_id AND r.mode = 'equal');

    IF NOT EXISTS (SELECT 1 FROM app.household_members m WHERE m.household_id = OLD.household_id) THEN
      DELETE FROM app.households h WHERE h.id = OLD.household_id;
    ELSIF NOT EXISTS (
      SELECT 1 FROM app.household_members m WHERE m.household_id = OLD.household_id AND m.role = 'admin'
    ) THEN
      UPDATE app.household_members m SET role = 'admin'
       WHERE (m.household_id, m.user_id) = (
         SELECT m2.household_id, m2.user_id FROM app.household_members m2
          WHERE m2.household_id = OLD.household_id ORDER BY m2.joined_at, m2.user_id LIMIT 1);
    END IF;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER household_members_removed AFTER DELETE ON app.household_members
  FOR EACH ROW EXECUTE FUNCTION app.after_member_removed();

-- Creating a household makes the current user its admin, atomically.
CREATE FUNCTION app.create_household(p_name text, p_display_name text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  DECLARE
    actor uuid := app.current_user_id();
    new_id uuid;
  BEGIN
    IF actor IS NULL THEN
      RAISE EXCEPTION 'no authenticated user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO app.households (name) VALUES (p_name) RETURNING id INTO new_id;
    INSERT INTO app.household_members (household_id, user_id, role, display_name)
      VALUES (new_id, actor, 'admin', p_display_name);
    RETURN new_id;
  END
  $$;

-- HU12, HU31: the invited user accepts explicitly with the token from the link. Returns the
-- household joined, or NULL when the invitation is unknown, used or expired.
CREATE FUNCTION app.accept_household_invitation(p_token_hash bytea, p_display_name text) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  DECLARE
    actor uuid := app.current_user_id();
    target uuid;
  BEGIN
    IF actor IS NULL THEN
      RAISE EXCEPTION 'no authenticated user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE app.household_invitations i SET accepted_at = now()
     WHERE i.token_hash = p_token_hash AND i.accepted_at IS NULL AND i.expires_at > now()
    RETURNING i.household_id INTO target;
    IF target IS NULL THEN
      RETURN NULL;
    END IF;
    INSERT INTO app.household_members (household_id, user_id, role, display_name)
      VALUES (target, actor, 'member', p_display_name);
    RETURN target;
  END
  $$;

ALTER TABLE app.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.household_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.household_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contribution_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.contribution_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY households_read ON app.households FOR SELECT TO app_api
  USING (app.is_household_member(id));
CREATE POLICY households_admin_update ON app.households FOR UPDATE TO app_api
  USING (app.is_household_admin(id)) WITH CHECK (app.is_household_admin(id));
CREATE POLICY households_admin_delete ON app.households FOR DELETE TO app_api
  USING (app.is_household_admin(id));

CREATE POLICY members_read ON app.household_members FOR SELECT TO app_api
  USING (app.is_household_member(household_id));
CREATE POLICY members_update_self ON app.household_members FOR UPDATE TO app_api
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
-- HU12: the admin removes members; any member may leave.
CREATE POLICY members_delete ON app.household_members FOR DELETE TO app_api
  USING (user_id = app.current_user_id() OR app.is_household_admin(household_id));

CREATE POLICY invitations_admin ON app.household_invitations TO app_api
  USING (app.is_household_admin(household_id)) WITH CHECK (app.is_household_admin(household_id));

CREATE POLICY household_expenses_read ON app.household_expenses FOR SELECT TO app_api
  USING (app.is_household_member(household_id));
CREATE POLICY household_expenses_insert ON app.household_expenses FOR INSERT TO app_api
  WITH CHECK (app.is_household_member(household_id) AND created_by = app.current_user_id());
-- Only current members may write: a former member keeps no access to the shared space.
CREATE POLICY household_expenses_update ON app.household_expenses FOR UPDATE TO app_api
  USING (app.is_household_member(household_id)
         AND (created_by = app.current_user_id() OR app.is_household_admin(household_id)))
  WITH CHECK (app.is_household_member(household_id));
CREATE POLICY household_expenses_delete ON app.household_expenses FOR DELETE TO app_api
  USING (app.is_household_member(household_id)
         AND (created_by = app.current_user_id() OR app.is_household_admin(household_id)));

CREATE POLICY contribution_rules_read ON app.contribution_rules FOR SELECT TO app_api
  USING (app.is_household_member(household_id));
CREATE POLICY contribution_rules_write ON app.contribution_rules FOR ALL TO app_api
  USING (app.is_household_admin(household_id)) WITH CHECK (app.is_household_admin(household_id));
CREATE POLICY contribution_shares_read ON app.contribution_shares FOR SELECT TO app_api
  USING (app.is_household_member(household_id));
CREATE POLICY contribution_shares_write ON app.contribution_shares FOR ALL TO app_api
  USING (app.is_household_admin(household_id)) WITH CHECK (app.is_household_admin(household_id));

GRANT SELECT, UPDATE, DELETE ON app.households TO app_api;
GRANT SELECT, DELETE ON app.household_members TO app_api;
GRANT UPDATE (display_name) ON app.household_members TO app_api;
GRANT SELECT, INSERT, DELETE ON app.household_invitations TO app_api;
GRANT SELECT, INSERT, DELETE ON app.household_expenses TO app_api;
-- The author, the household and the id of a shared expense cannot be rewritten.
GRANT UPDATE (label, amount, schedule_kind, interval_months, from_month, until_month, updated_at)
  ON app.household_expenses TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.contribution_rules, app.contribution_shares TO app_api;
GRANT EXECUTE ON FUNCTION app.is_household_member(uuid), app.is_household_admin(uuid),
  app.create_household(text, text), app.accept_household_invitation(bytea, text) TO app_api;
