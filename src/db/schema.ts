import { randomUUID } from "node:crypto";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const envelopeStatus = [
  "pending_sender",
  "pending",
  "completed",
  "declined",
  "cancelled",
  "expired",
  "deleted",
] as const;
export type EnvelopeStatus = (typeof envelopeStatus)[number];

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
] as const;
export type AuditEvent = (typeof auditEvent)[number];

export const documentKind = ["original", "sealed", "certificate"] as const;
export type DocumentKind = (typeof documentKind)[number];

export const apiKeyKind = ["tmp", "live"] as const;
export type ApiKeyKind = (typeof apiKeyKind)[number];

export const accountPlan = ["free", "pro"] as const;
export type AccountPlan = (typeof accountPlan)[number];

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const envelopes = pgTable("envelopes", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  userId: uuid("user_id"),
  status: text("status", { enum: envelopeStatus }).notNull(),
  title: text("title").notNull(),
  senderEmail: text("sender_email").notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
  shredAt: timestamptz("shred_at").notNull(),
  webhookUrl: text("webhook_url"),
  /** HMAC key shown once as webhook_secret. Column name is historical. */
  webhookSecretHash: text("webhook_secret_hash"),
  sha256: text("sha256"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}).enableRLS();

export const signers = pgTable("signers", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  envelopeId: uuid("envelope_id")
    .notNull()
    .references(() => envelopes.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  signingOrder: integer("signing_order").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  sentAt: timestamptz("sent_at"),
  openedAt: timestamptz("opened_at"),
  consentedAt: timestamptz("consented_at"),
  signedAt: timestamptz("signed_at"),
  declinedAt: timestamptz("declined_at"),
  remindedAt: timestamptz("reminded_at"),
  ip: text("ip"),
  ua: text("ua"),
  consentUa: text("consent_ua"),
}).enableRLS();

export const documents = pgTable("documents", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  envelopeId: uuid("envelope_id")
    .notNull()
    .references(() => envelopes.id),
  kind: text("kind", { enum: documentKind }).notNull(),
  storagePath: text("storage_path").notNull(),
  documentHash: text("document_hash").notNull(),
}).enableRLS();

/** Envelope/PDF shred leaves rows; do not ON DELETE CASCADE. */
export const auditEvents = pgTable("audit_events", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  envelopeId: uuid("envelope_id")
    .notNull()
    .references(() => envelopes.id),
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
  envelopeId: uuid("envelope_id")
    .notNull()
    .references(() => envelopes.id),
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
  envelopeId: uuid("envelope_id").references(() => envelopes.id),
  userId: uuid("user_id"),
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
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}).enableRLS();

export const memberStatus = ["invited", "active"] as const;
export type MemberStatus = (typeof memberStatus)[number];

export const packets = pgTable("packets", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  ownerUserId: uuid("owner_user_id").notNull(),
  createdByUserId: uuid("created_by_user_id").notNull(),
  title: text("title").notNull(),
  storagePath: text("storage_path").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
}).enableRLS();

export const packetRoles = pgTable("packet_roles", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  packetId: uuid("packet_id")
    .notNull()
    .references(() => packets.id),
  signingOrder: integer("signing_order").notNull(),
  roleName: text("role_name").notNull(),
}).enableRLS();

export const cabinetMembers = pgTable("cabinet_members", {
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
}).enableRLS();
