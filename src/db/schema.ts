import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DocumentField } from "../lib/pdf/fields.js";

export const documentStatus = [
  "pending_sender",
  "pending",
  "completed",
  "declined",
  "cancelled",
  "expired",
  "deleted",
] as const;
export type DocumentStatus = (typeof documentStatus)[number];

export const auditEvent = [
  "sent",
  "opened",
  "consented",
  "signed",
  "emailed",
  "emailed_failed",
  "otp_sent",
  "email_verified",
  "declined",
  "reminded",
  "expired",
  "deleted",
  "webhook_sent",
  "webhook_failed",
  "attested",
  "rejected",
] as const;
export type AuditEvent = (typeof auditEvent)[number];

export const fileKind = ["original", "sealed", "certificate"] as const;
export type FileKind = (typeof fileKind)[number];

export const apiKeyKind = ["tmp", "live", "agent"] as const;
export type ApiKeyKind = (typeof apiKeyKind)[number];

export const partyKind = ["human", "agent"] as const;
export type PartyKind = (typeof partyKind)[number];

export const attestMethodKind = ["agent_key", "oauth"] as const;
export type AttestMethod = (typeof attestMethodKind)[number];

export const accountPlan = ["free", "pro"] as const;
export type AccountPlan = (typeof accountPlan)[number];

export const signingModes = ["sequential", "parallel"] as const;
export type SigningMode = (typeof signingModes)[number];

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const documents = pgTable("documents", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  userId: uuid("user_id"),
  status: text("status", { enum: documentStatus }).notNull(),
  title: text("title").notNull(),
  senderEmail: text("sender_email").notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
  shredAt: timestamptz("shred_at").notNull(),
  webhookUrl: text("webhook_url"),
  /** HMAC key shown once as webhook_secret. Column name is historical. */
  webhookSecretHash: text("webhook_secret_hash"),
  sha256: text("sha256"),
  fields: jsonb("fields")
    .$type<DocumentField[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  signingMode: text("signing_mode", { enum: signingModes })
    .notNull()
    .default("sequential"),
  sendEmail: boolean("send_email").notNull().default(true),
  completedRedirectUrl: text("completed_redirect_url"),
  embedOrigin: text("embed_origin"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}).enableRLS();

export const signers = pgTable("signers", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  signingOrder: integer("signing_order").notNull(),
  kind: text("kind", { enum: partyKind }).notNull().default("human"),
  agentId: uuid("agent_id").references(() => agents.id),
  attestedAt: timestamptz("attested_at"),
  rejectedAt: timestamptz("rejected_at"),
  attestMethod: text("attest_method", { enum: attestMethodKind }),
  attestLabel: text("attest_label"),
  tokenHash: text("token_hash").unique(),
  tokenEnc: text("token_enc"),
  sentAt: timestamptz("sent_at"),
  openedAt: timestamptz("opened_at"),
  consentedAt: timestamptz("consented_at"),
  signedAt: timestamptz("signed_at"),
  declinedAt: timestamptz("declined_at"),
  remindedAt: timestamptz("reminded_at"),
  ip: text("ip"),
  ua: text("ua"),
  consentUa: text("consent_ua"),
  roleName: text("role_name"),
  values: jsonb("values")
    .$type<Record<string, string | boolean>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
}).enableRLS();

export const files = pgTable("files", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  kind: text("kind", { enum: fileKind }).notNull(),
  storagePath: text("storage_path").notNull(),
  fileHash: text("file_hash").notNull(),
}).enableRLS();

/** Document/PDF shred leaves rows; do not ON DELETE CASCADE. */
export const auditEvents = pgTable("audit_events", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  signerId: uuid("signer_id").references(() => signers.id),
  event: text("event", { enum: auditEvent }).notNull(),
  ip: text("ip"),
  ua: text("ua"),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}).enableRLS();

export const otpChallenges = pgTable("otp_challenges", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamptz("consumed_at"),
}).enableRLS();

export const apiKeys = pgTable("api_keys", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  kind: text("kind", { enum: apiKeyKind }).notNull(),
  prefix: text("prefix").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  documentId: uuid("document_id").references(() => documents.id),
  userId: uuid("user_id"),
  agentId: uuid("agent_id").references(() => agents.id),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  expiresAt: timestamptz("expires_at").notNull(),
}).enableRLS();

export const accounts = pgTable("accounts", {
  userId: uuid("user_id").primaryKey(),
  email: text("email"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  plan: text("plan", { enum: accountPlan }).notNull().default("free"),
  currentPeriodEnd: timestamptz("current_period_end"),
  displayName: text("display_name"),
  logoPath: text("logo_path"),
  timezone: text("timezone"),
  description: text("description"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}).enableRLS();

export const memberStatus = ["invited", "active"] as const;
export type MemberStatus = (typeof memberStatus)[number];

export const templates = pgTable("templates", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  ownerUserId: uuid("owner_user_id").notNull(),
  createdByUserId: uuid("created_by_user_id").notNull(),
  title: text("title").notNull(),
  storagePath: text("storage_path").notNull(),
  fields: jsonb("fields")
    .$type<DocumentField[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}).enableRLS();

export const templateRoles = pgTable("template_roles", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  templateId: uuid("template_id")
    .notNull()
    .references(() => templates.id),
  signingOrder: integer("signing_order").notNull(),
  roleName: text("role_name").notNull(),
}).enableRLS();

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    ownerUserId: uuid("owner_user_id").notNull(),
    email: text("email").notNull(),
    userId: uuid("user_id"),
    status: text("status", { enum: memberStatus }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedAt: timestamptz("invited_at").notNull(),
    acceptedAt: timestamptz("accepted_at"),
  },
  (t) => [uniqueIndex("team_members_owner_email").on(t.ownerUserId, t.email)],
).enableRLS();

export const agents = pgTable(
  "agents",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    ownerUserId: uuid("owner_user_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    webhookUrl: text("webhook_url"),
    webhookSecretHash: text("webhook_secret_hash"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    revokedAt: timestamptz("revoked_at"),
  },
  (t) => [uniqueIndex("agents_owner_slug").on(t.ownerUserId, t.slug)],
).enableRLS();

export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  clientId: text("client_id").notNull().unique(),
  clientName: text("client_name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  authMethod: text("auth_method").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}).enableRLS();

export const oauthGrants = pgTable("oauth_grants", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  userId: uuid("user_id").notNull(),
  clientId: text("client_id").notNull(),
  allowedAgentIds: jsonb("allowed_agent_ids").$type<string[]>().notNull().default([]),
  accessHash: text("access_hash"),
  refreshHash: text("refresh_hash"),
  /** Prior refresh hash; presenting it revokes the grant (OAuth 2.1 reuse). */
  previousRefreshHash: text("previous_refresh_hash"),
  /** Audience: MCP canonical URI this access token was issued for. */
  resource: text("resource"),
  expiresAt: timestamptz("expires_at"),
  revokedAt: timestamptz("revoked_at"),
}).enableRLS();

export const oauthCodes = pgTable("oauth_codes", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  codeHash: text("code_hash").notNull(),
  userId: uuid("user_id").notNull(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  resource: text("resource").notNull(),
  allowedAgentIds: jsonb("allowed_agent_ids").$type<string[]>(),
  expiresAt: timestamptz("expires_at").notNull(),
  consumedAt: timestamptz("consumed_at"),
}).enableRLS();
