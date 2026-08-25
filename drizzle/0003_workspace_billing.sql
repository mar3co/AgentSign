-- Workspace settings: timezone and description.
-- Tests use PGlite pushSchema and do not run this file.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS description text;
