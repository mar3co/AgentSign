-- Connected-apps list: when the OAuth grant was made, shown next to the
-- client name in Settings > Security.
-- Tests use PGlite pushSchema and do not run this file.

ALTER TABLE oauth_grants ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
