-- Consent registry (Ley 21.719, HU32, HU36) and initial-registration timestamps for the KPI of
-- section 4.1 of the report (completion rate and median time of the initial registration).

-- One row per consent given. Withdrawing sets withdrawn_at; a new acceptance (for example of a
-- new version of the terms) is a new row, so the history of what each user accepted is kept.
-- Rows are erased with the account (HU21, effective deletion).
CREATE TABLE app.consents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('terms', 'privacy_policy', 'bank_connection')),
  -- Version of the accepted document, e.g. '2026-10'.
  document_version text NOT NULL CHECK (length(btrim(document_version)) BETWEEN 1 AND 20),
  accepted_at      timestamptz NOT NULL DEFAULT now(),
  withdrawn_at     timestamptz,
  CHECK (withdrawn_at IS NULL OR withdrawn_at >= accepted_at)
);
CREATE INDEX consents_owner_idx ON app.consents (owner_id);
-- At most one active consent of each kind per user.
CREATE UNIQUE INDEX consents_active_key ON app.consents (owner_id, kind) WHERE withdrawn_at IS NULL;

ALTER TABLE app.consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY consents_owner ON app.consents TO app_api
  USING (owner_id = app.current_user_id()) WITH CHECK (owner_id = app.current_user_id());

-- A consent is never rewritten: the API can only record it and withdraw it. app_admin gets no
-- grant: consents are personal data the admin panel does not need.
GRANT SELECT, INSERT ON app.consents TO app_api;
GRANT UPDATE (withdrawn_at) ON app.consents TO app_api;

-- KPI "registro inicial": when the user opened the initial registration and when it was
-- completed (opening balance and at least one income, HU01 and HU04). Timestamps only, no
-- amounts, so the admin role may read them for aggregate indicators.
ALTER TABLE app.users
  ADD COLUMN onboarding_started_at   timestamptz,
  ADD COLUMN onboarding_completed_at timestamptz,
  ADD CHECK (onboarding_completed_at IS NULL
             OR (onboarding_started_at IS NOT NULL AND onboarding_completed_at >= onboarding_started_at));

GRANT UPDATE (onboarding_started_at, onboarding_completed_at) ON app.users TO app_api;
GRANT SELECT (onboarding_started_at, onboarding_completed_at) ON app.users TO app_admin;
