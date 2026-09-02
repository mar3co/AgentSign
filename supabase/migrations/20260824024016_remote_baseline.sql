-- Baseline: the schema in src/db/schema.ts as of Sep 2026 (drizzle-kit
-- generate), including columns the later bridge migrations add with IF NOT
-- EXISTS, so those apply cleanly on top. It is not a dump of the Aug 24 2026
-- production database: production already records this version as applied,
-- so supabase db push never runs it there, and production may carry a
-- foreign key to auth.users that schema.ts does not declare. This file exists
-- so a fresh database (the PGlite test suite, or supabase db push --db-url
-- against an empty project) can be built from supabase/migrations alone. Its
-- twin, 20260824024225_remote_baseline.sql, is an empty placeholder kept only
-- because production records that version as applied too.

CREATE TABLE "accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"stripe_customer_id" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"current_period_end" timestamp with time zone,
	"display_name" text,
	"logo_path" text,
	"timezone" text,
	"description" text,
	"confirm_agent_sends" boolean DEFAULT true NOT NULL,
	"confirm_human_sends" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"webhook_url" text,
	"webhook_secret_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);

ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"document_id" uuid,
	"user_id" uuid,
	"agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_keys_token_hash_unique" UNIQUE("token_hash")
);

ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"signer_id" uuid,
	"event" text NOT NULL,
	"ip" text,
	"ua" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"sender_email" text NOT NULL,
	"message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"shred_at" timestamp with time zone NOT NULL,
	"webhook_url" text,
	"webhook_secret_hash" text,
	"sha256" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signing_mode" text DEFAULT 'sequential' NOT NULL,
	"send_email" boolean DEFAULT true NOT NULL,
	"completed_redirect_url" text,
	"embed_origin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_hash" text NOT NULL
);

ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "oauth_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"auth_method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);

ALTER TABLE "oauth_clients" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "oauth_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"resource" text NOT NULL,
	"allowed_agent_ids" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);

ALTER TABLE "oauth_codes" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "oauth_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"allowed_agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_hash" text,
	"refresh_hash" text,
	"previous_refresh_hash" text,
	"resource" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);

ALTER TABLE "oauth_grants" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone
);

ALTER TABLE "otp_challenges" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "signers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"signing_order" integer NOT NULL,
	"kind" text DEFAULT 'human' NOT NULL,
	"agent_id" uuid,
	"attested_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"attest_method" text,
	"attest_label" text,
	"token_hash" text,
	"token_enc" text,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"consented_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"ip" text,
	"ua" text,
	"consent_ua" text,
	"role_name" text,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "signers_token_hash_unique" UNIQUE("token_hash")
);

ALTER TABLE "signers" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"status" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "team_members_token_hash_unique" UNIQUE("token_hash")
);

ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "template_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"signing_order" integer NOT NULL,
	"role_name" text NOT NULL
);

ALTER TABLE "template_roles" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"storage_path" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_signer_id_signers_id_fk" FOREIGN KEY ("signer_id") REFERENCES "public"."signers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "files" ADD CONSTRAINT "files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "signers" ADD CONSTRAINT "signers_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "signers" ADD CONSTRAINT "signers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "template_roles" ADD CONSTRAINT "template_roles_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "agents_owner_slug" ON "agents" USING btree ("owner_user_id","slug");
CREATE UNIQUE INDEX "team_members_owner_email" ON "team_members" USING btree ("owner_user_id","email");
