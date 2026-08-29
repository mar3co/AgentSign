-- Bridge of drizzle/0003_workspace_billing.sql and drizzle/0004_on_page_fields.sql
-- (remote baseline from Aug 24 predates these; drizzle SQL is the source of truth)

-- Workspace settings: timezone and description.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS description text;

-- On-page fields, parallel signing, embed, and send_email.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS signing_mode text NOT NULL DEFAULT 'sequential';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS send_email boolean NOT NULL DEFAULT true;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS completed_redirect_url text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS embed_origin text;

ALTER TABLE signers ADD COLUMN IF NOT EXISTS role_name text;
ALTER TABLE signers ADD COLUMN IF NOT EXISTS values jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE templates ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb;
