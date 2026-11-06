-- Plan prices, household space validity (HU12-HU15, HU20), invitation preview (HU31) and the
-- Webpay return lookup (HU19).

-- Business model of the Informe 2: paid $5.990 and family $9.990 per month (CLP, integers).
UPDATE app.plans SET price_clp = 5990 WHERE code = 'paid';
UPDATE app.plans SET price_clp = 9990 WHERE code = 'family';

-- HU20: the shared space is writable while at least one member has a plan in force that includes
-- it (Tabla 13, family plan). Otherwise it stays readable but read-only, and no data is deleted.
-- Answers only to members of that household, so it never reveals other households' plans.
CREATE FUNCTION app.household_space_active(p_household_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
    SELECT app.is_household_member(p_household_id) AND EXISTS (
      SELECT 1
        FROM app.household_members m
        JOIN app.subscriptions s ON s.user_id = m.user_id
        JOIN app.plans p ON p.code = s.plan_code
       WHERE m.household_id = p_household_id
         AND p.household_space
         AND s.period_start <= app.today_cl()
         AND s.period_end > app.today_cl()
    )
  $$;

-- HU31: before accepting, the invited person sees the household name and how many members it
-- has. Only a valid (unused, unexpired) invitation answers; nothing about the members' data.
CREATE FUNCTION app.preview_household_invitation(p_token_hash bytea)
  RETURNS TABLE (household_name text, member_count integer, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
    SELECT h.name::text,
           (SELECT count(*)::integer FROM app.household_members m WHERE m.household_id = h.id),
           i.expires_at
      FROM app.household_invitations i
      JOIN app.households h ON h.id = i.household_id
     WHERE i.token_hash = p_token_hash AND i.accepted_at IS NULL AND i.expires_at > now()
  $$;

-- HU19: Webpay sends the browser back without the user's session (cross-site redirect). The
-- backend finds the order by the provider token it stored when starting the transaction, then
-- confirms the outcome with Transbank itself (rule 6). Returns nothing for an unknown token.
CREATE FUNCTION app.find_payment_order_by_token(p_token text)
  RETURNS TABLE (buy_order text, user_id uuid, status text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
    SELECT o.buy_order, o.user_id, o.status FROM app.payment_orders o WHERE o.provider_token = p_token
  $$;

GRANT EXECUTE ON FUNCTION app.household_space_active(uuid), app.preview_household_invitation(bytea),
  app.find_payment_order_by_token(text) TO app_api;
