-- Plans and subscriptions (Tabla 13, Tabla 14, HU18-HU20, HU26). No card data is ever stored
-- (rule 6, RNF09): Webpay processes the card; this schema only keeps orders and outcomes.

CREATE TABLE app.plans (
  code                   text PRIMARY KEY CHECK (code IN ('free', 'paid', 'family')),
  name                   app.label NOT NULL,
  -- NULL: not for sale. The report does not set prices yet.
  price_clp              app.clp CHECK (price_clp IS NULL OR price_clp > 0),
  period_months          smallint NOT NULL DEFAULT 1 CHECK (period_months BETWEEN 1 AND 12),
  -- NULL means unlimited.
  max_saved_scenarios    integer CHECK (max_saved_scenarios IS NULL OR max_saved_scenarios >= 0),
  max_compared_scenarios integer CHECK (max_compared_scenarios IS NULL OR max_compared_scenarios >= 1),
  full_history           boolean NOT NULL,
  user_prepayments       boolean NOT NULL,
  household_space        boolean NOT NULL
);

-- Tabla 13. Free: 2 saved scenarios and 1 compared against the base (decision of 02-10-2026).
-- Paid and family: unlimited saved scenarios; comparison of up to 5 (RNF02).
INSERT INTO app.plans
  (code, name, price_clp, max_saved_scenarios, max_compared_scenarios, full_history, user_prepayments, household_space)
VALUES
  ('free',   'Gratuito', NULL, 2,    1, false, false, false),
  ('paid',   'Pagado',   NULL, NULL, 5, true,  true,  false),
  ('family', 'Familiar', NULL, NULL, 5, true,  true,  true);

-- Current paid period of a user. No row means the free plan. The Tabla 14 state
-- (activa, por vencer, vencida, cancelada) is derived from these dates, never stored, so it
-- cannot become stale; pendiente and fallida come from the latest payment order.
CREATE TABLE app.subscriptions (
  user_id              uuid PRIMARY KEY REFERENCES app.users (id) ON DELETE CASCADE,
  plan_code            text NOT NULL REFERENCES app.plans (code),
  period_start         date NOT NULL,
  period_end           date NOT NULL,
  -- Tabla 14 "Cancelada": access continues until period_end, then the plan is not renewed.
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (plan_code <> 'free'),
  CHECK (period_end > period_start)
);

-- Webpay Plus orders (HU19, HU26). `buy_order` is unique, which makes activation idempotent.
CREATE TABLE app.payment_orders (
  buy_order         text PRIMARY KEY CHECK (buy_order ~ '^[A-Za-z0-9_-]{1,26}$'),
  -- Kept as NULL after account deletion so reconciliation with the provider still works.
  user_id           uuid REFERENCES app.users (id) ON DELETE SET NULL,
  plan_code         text NOT NULL REFERENCES app.plans (code),
  amount            app.clp NOT NULL CHECK (amount > 0),
  provider_token    text UNIQUE CHECK (length(provider_token) <= 128),
  status            text NOT NULL DEFAULT 'created'
                    CHECK (status IN ('created', 'authorized', 'rejected', 'aborted', 'amount_mismatch')),
  -- What the provider reported, kept for reconciliation (HU26).
  authorized_amount app.clp,
  response_code     text CHECK (length(response_code) <= 32),
  created_at        timestamptz NOT NULL DEFAULT now(),
  committed_at      timestamptz,
  activated_at      timestamptz,
  CHECK (plan_code <> 'free'),
  CHECK (activated_at IS NULL OR status = 'authorized')
);
CREATE INDEX payment_orders_user_idx ON app.payment_orders (user_id);
-- HU26: orders that need a human look.
CREATE INDEX payment_orders_review_idx ON app.payment_orders (status) WHERE status = 'amount_mismatch';

ALTER TABLE app.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payment_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_owner_read ON app.subscriptions FOR SELECT TO app_api
  USING (user_id = app.current_user_id());
CREATE POLICY subscriptions_admin_read ON app.subscriptions FOR SELECT TO app_admin USING (true);

CREATE POLICY payment_orders_owner_read ON app.payment_orders FOR SELECT TO app_api
  USING (user_id = app.current_user_id());
-- A new order starts clean and at the plan's current price; outcomes are set only by
-- settle_payment_order.
CREATE POLICY payment_orders_owner_create ON app.payment_orders FOR INSERT TO app_api
  WITH CHECK (
    user_id = app.current_user_id()
    AND status = 'created'
    AND provider_token IS NULL AND authorized_amount IS NULL AND response_code IS NULL
    AND committed_at IS NULL AND activated_at IS NULL
    AND amount = (SELECT p.price_clp FROM app.plans p WHERE p.code = plan_code)
  );
-- The API stores the Webpay token of a pending order after starting the transaction.
CREATE POLICY payment_orders_owner_token ON app.payment_orders FOR UPDATE TO app_api
  USING (user_id = app.current_user_id() AND status = 'created' AND provider_token IS NULL)
  WITH CHECK (user_id = app.current_user_id() AND status = 'created');
CREATE POLICY payment_orders_admin_read ON app.payment_orders FOR SELECT TO app_admin USING (true);

-- Subscriptions change only through the functions below.
GRANT SELECT ON app.plans TO app_api, app_admin;
GRANT SELECT ON app.subscriptions TO app_api, app_admin;
GRANT SELECT, INSERT ON app.payment_orders TO app_api;
GRANT UPDATE (provider_token) ON app.payment_orders TO app_api;
GRANT SELECT ON app.payment_orders TO app_admin;

-- Records the provider's outcome for an order and, when authorized, activates the plan exactly
-- once (rule 6, RNF04). Called by the backend after it commits the transaction with Webpay; it
-- never trusts the browser return. The order must belong to p_user_id, and the amount must match
-- both the order and the plan price. Dates are Chile dates (app.today_cl()).
-- Renewing the same plan before it expires extends the period; any other purchase starts a new
-- period today (an upgrade does not extend the remaining paid time for free).
CREATE FUNCTION app.settle_payment_order(
  p_buy_order text, p_user_id uuid, p_status text, p_amount bigint, p_response_code text
) RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
  DECLARE
    payment app.payment_orders%ROWTYPE;
    plan app.plans%ROWTYPE;
    current_sub app.subscriptions%ROWTYPE;
    today date := app.today_cl();
    new_start date;
  BEGIN
    IF p_status NOT IN ('authorized', 'rejected', 'aborted') THEN
      RAISE EXCEPTION 'invalid payment status' USING ERRCODE = 'check_violation';
    END IF;

    -- Serializes every settlement of this user, including the first one (no subscription row yet).
    PERFORM pg_advisory_xact_lock(hashtextextended('app.subscriptions:' || p_user_id::text, 0));

    SELECT * INTO payment FROM app.payment_orders o WHERE o.buy_order = p_buy_order FOR UPDATE;
    IF NOT FOUND OR payment.user_id IS DISTINCT FROM p_user_id THEN
      RETURN 'unknown_order';
    END IF;
    IF payment.activated_at IS NOT NULL THEN
      RETURN 'already_activated';
    END IF;
    IF payment.status <> 'created' THEN
      RETURN 'already_settled';
    END IF;

    IF p_status <> 'authorized' THEN
      UPDATE app.payment_orders o
         SET status = p_status, response_code = p_response_code, committed_at = now()
       WHERE o.buy_order = p_buy_order;
      RETURN p_status;
    END IF;

    SELECT * INTO plan FROM app.plans p WHERE p.code = payment.plan_code;
    IF p_amount IS DISTINCT FROM payment.amount OR plan.price_clp IS DISTINCT FROM payment.amount THEN
      UPDATE app.payment_orders o
         SET status = 'amount_mismatch', authorized_amount = p_amount, response_code = p_response_code,
             committed_at = now()
       WHERE o.buy_order = p_buy_order;
      RETURN 'amount_mismatch';
    END IF;

    SELECT * INTO current_sub FROM app.subscriptions s WHERE s.user_id = p_user_id FOR UPDATE;
    new_start := CASE
      WHEN FOUND AND current_sub.plan_code = payment.plan_code AND current_sub.period_end > today
        THEN current_sub.period_end
      ELSE today
    END;

    INSERT INTO app.subscriptions (user_id, plan_code, period_start, period_end, cancel_at_period_end, updated_at)
      VALUES (p_user_id, payment.plan_code, today,
              (new_start + make_interval(months => plan.period_months))::date, false, now())
      ON CONFLICT (user_id) DO UPDATE
        SET plan_code = EXCLUDED.plan_code,
            period_start = CASE WHEN new_start = today THEN today ELSE app.subscriptions.period_start END,
            period_end = EXCLUDED.period_end,
            cancel_at_period_end = false,
            updated_at = now();

    UPDATE app.payment_orders o
       SET status = 'authorized', authorized_amount = p_amount, response_code = p_response_code,
           committed_at = now(), activated_at = now()
     WHERE o.buy_order = p_buy_order;
    RETURN 'activated';
  END
  $$;

-- Tabla 14 "Cancelada": the current user stops the renewal; access lasts until period_end.
CREATE FUNCTION app.cancel_subscription() RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
    UPDATE app.subscriptions s SET cancel_at_period_end = true, updated_at = now()
     WHERE s.user_id = app.current_user_id() AND s.period_end > app.today_cl()
    RETURNING true
  $$;

GRANT EXECUTE ON FUNCTION app.settle_payment_order(text, uuid, text, bigint, text) TO app_api;
GRANT EXECUTE ON FUNCTION app.cancel_subscription() TO app_api;
