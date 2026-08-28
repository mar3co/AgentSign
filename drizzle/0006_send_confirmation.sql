-- Send confirmation settings: OAuth-connected agent sends need an emailed
-- code by default; the owner's own web sends can opt in to the same code.
-- Tests use PGlite pushSchema and do not run this file.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS confirm_agent_sends boolean NOT NULL DEFAULT true;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS confirm_human_sends boolean NOT NULL DEFAULT false;
