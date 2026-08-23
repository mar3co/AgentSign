-- Plain names: envelopes -> documents, documents -> files, packets -> templates,
-- cabinet_members -> team_members.
-- Apply against a v1.2 Postgres (Supabase) before deploying this branch.
-- Tests use PGlite pushSchema and do not run this file.
-- Storage note: the Supabase Storage bucket keeps its historical "envelopes"
-- name (buckets cannot be renamed in place); STORAGE_BUCKET defaults match.

BEGIN;

-- Order matters: free up the "documents" name first.
ALTER TABLE documents RENAME TO files;
ALTER TABLE files RENAME COLUMN envelope_id TO document_id;
ALTER TABLE files RENAME COLUMN document_hash TO file_hash;
ALTER TABLE files RENAME CONSTRAINT documents_pkey TO files_pkey;
ALTER TABLE files RENAME CONSTRAINT documents_envelope_id_envelopes_id_fk TO files_document_id_documents_id_fk;

ALTER TABLE envelopes RENAME TO documents;
ALTER TABLE documents RENAME CONSTRAINT envelopes_pkey TO documents_pkey;

ALTER TABLE signers RENAME COLUMN envelope_id TO document_id;
ALTER TABLE signers RENAME CONSTRAINT signers_envelope_id_envelopes_id_fk TO signers_document_id_documents_id_fk;

ALTER TABLE audit_events RENAME COLUMN envelope_id TO document_id;
ALTER TABLE audit_events RENAME CONSTRAINT audit_events_envelope_id_envelopes_id_fk TO audit_events_document_id_documents_id_fk;

ALTER TABLE otp_challenges RENAME COLUMN envelope_id TO document_id;
ALTER TABLE otp_challenges RENAME CONSTRAINT otp_challenges_envelope_id_envelopes_id_fk TO otp_challenges_document_id_documents_id_fk;

ALTER TABLE api_keys RENAME COLUMN envelope_id TO document_id;
ALTER TABLE api_keys RENAME CONSTRAINT api_keys_envelope_id_envelopes_id_fk TO api_keys_document_id_documents_id_fk;

ALTER TABLE packets RENAME TO templates;
ALTER TABLE templates RENAME CONSTRAINT packets_pkey TO templates_pkey;
ALTER TABLE packet_roles RENAME TO template_roles;
ALTER TABLE template_roles RENAME COLUMN packet_id TO template_id;
ALTER TABLE template_roles RENAME CONSTRAINT packet_roles_pkey TO template_roles_pkey;
ALTER TABLE template_roles RENAME CONSTRAINT packet_roles_packet_id_packets_id_fk TO template_roles_template_id_templates_id_fk;

ALTER TABLE cabinet_members RENAME TO team_members;
ALTER TABLE team_members RENAME CONSTRAINT cabinet_members_pkey TO team_members_pkey;
ALTER TABLE team_members RENAME CONSTRAINT cabinet_members_token_hash_unique TO team_members_token_hash_unique;
ALTER INDEX cabinet_members_owner_email RENAME TO team_members_owner_email;

COMMIT;
