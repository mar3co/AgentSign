-- AgentSign v1.2: mixed parties, named agents, OAuth, reminder reprint.
-- Apply against an existing v1/v1.1 Postgres (Supabase) before deploying this branch.
-- Tests use PGlite pushSchema and do not run this file.

ALTER TABLE signers ALTER COLUMN token_hash DROP NOT NULL;

ALTER TABLE signers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'human';
ALTER TABLE signers ADD COLUMN IF NOT EXISTS agent_id uuid;
ALTER TABLE signers ADD COLUMN IF NOT EXISTS attested_at timestamptz;
ALTER TABLE signers ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE signers ADD COLUMN IF NOT EXISTS attest_method text;
ALTER TABLE signers ADD COLUMN IF NOT EXISTS attest_label text;
ALTER TABLE signers ADD COLUMN IF NOT EXISTS token_enc text;

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS agent_id uuid;

CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  webhook_url text,
  webhook_secret_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_owner_slug ON agents (owner_user_id, slug);

CREATE TABLE IF NOT EXISTS oauth_clients (
  id uuid PRIMARY KEY,
  client_id text NOT NULL UNIQUE,
  client_name text NOT NULL,
  redirect_uris jsonb NOT NULL,
  auth_method text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  client_id text NOT NULL,
  allowed_agent_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  access_hash text,
  refresh_hash text,
  previous_refresh_hash text,
  resource text,
  expires_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  id uuid PRIMARY KEY,
  code_hash text NOT NULL,
  user_id uuid NOT NULL,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  resource text NOT NULL,
  allowed_agent_ids jsonb,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signers_agent_id_agents_id_fk'
  ) THEN
    ALTER TABLE signers
      ADD CONSTRAINT signers_agent_id_agents_id_fk
      FOREIGN KEY (agent_id) REFERENCES agents(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_agent_id_agents_id_fk'
  ) THEN
    ALTER TABLE api_keys
      ADD CONSTRAINT api_keys_agent_id_agents_id_fk
      FOREIGN KEY (agent_id) REFERENCES agents(id);
  END IF;
END $$;
