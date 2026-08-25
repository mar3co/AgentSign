-- Workspace + billing settings: timezone, description, custom signing domain.
-- Tests use PGlite pushSchema and do not run this file.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS custom_domain text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS custom_domain_verified_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_custom_domain_unique'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_custom_domain_unique UNIQUE (custom_domain);
  END IF;
END $$;
