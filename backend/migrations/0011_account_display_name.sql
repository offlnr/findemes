-- Account alias asked at registration (CU-08): shown in the app greeting and in emails, and
-- offered as the default name when joining a household (each membership keeps its own
-- display_name). Not the legal name: the product needs no more than this (data minimization,
-- Ley 21.719). Existing rows are filled from the local part of the email before NOT NULL.
ALTER TABLE app.users ADD COLUMN display_name app.label;
UPDATE app.users SET display_name = left(split_part(email, '@', 1), 40) WHERE display_name IS NULL;
ALTER TABLE app.users
  ALTER COLUMN display_name SET NOT NULL,
  ADD CHECK (length(btrim(display_name)) BETWEEN 2 AND 40);

-- The user can rectify the alias (HU21); administrators do not need it.
GRANT UPDATE (display_name) ON app.users TO app_api;
