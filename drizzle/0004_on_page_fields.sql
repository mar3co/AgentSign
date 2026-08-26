-- On-page fields, parallel signing, embed, and send_email.
-- Tests use PGlite pushSchema and do not run this file.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS signing_mode text NOT NULL DEFAULT 'sequential';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS send_email boolean NOT NULL DEFAULT true;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS completed_redirect_url text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embed_origin text;

ALTER TABLE signers ADD COLUMN IF NOT EXISTS role_name text;
ALTER TABLE signers ADD COLUMN IF NOT EXISTS values jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE templates ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb;
