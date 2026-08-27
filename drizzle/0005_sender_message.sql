-- Optional sender message shown in the invite email.
-- Tests use PGlite pushSchema and do not run this file.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS message text;
