import { and, count, eq, gte, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import {
  accounts,
  agents,
  apiKeys,
  auditEvents,
  documents,
  envelopes,
  otpChallenges,
  signers as signersTable,
} from "../db/schema.js";
import { loadActiveAgentBySlug, parseAgentSlug } from "../lib/agents.js";
import { logEvent, type AuditDb } from "../lib/audit.js";
import type { AuthUser } from "../lib/auth/supabase.js";
import { getAuth } from "../lib/auth/supabase.js";
import { cabinetForUser } from "../lib/cabinet.js";
import { getDeps, storeUnavailableResponse } from "../lib/deps.js";
import { flagOn } from "../lib/flags.js";
import { loadBrand } from "../lib/branding.js";
import {
  brandMailAttachments,
  createMailer,
  inviteEmail,
  otpEmail,
  type Mailer,
} from "../lib/email.js";
import { sha256Hex } from "../lib/hash.js";
import {
  claimSends,
  ensureAccount,
  lookupApiKey,
} from "../lib/keys.js";
import { accountForOauthGrant, lookupOauthGrant } from "../lib/oauth.js";
import { newOtp } from "../lib/otp.js";
import { objectKey, type BlobStore } from "../lib/storage.js";
import { newSigningToken, placeholderSigningTokenHash } from "../lib/tokens.js";
import {
  newWebhookSecret,
  sealWebhookSecret,
  webhookUrlError,
} from "../lib/webhooks.js";
import { getEnv } from "../env.js";
import { purgeEnvelope } from "../jobs/shred.js";

const PDF_MAX_BYTES = 20 * 1024 * 1024;
const OTP_TTL_MS = 10 * 60 * 1000;

const signerSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  kind: z.enum(["human", "agent"]).optional(),
  agent: z.string().optional(),
});
const signersSchema = z.array(signerSchema).min(1);

type ParsedSigner = z.infer<typeof signerSchema>;
type ResolvedParty = {
  name: string;
  email: string;
  kind: "human" | "agent";
  agentId: string | null;
};

async function resolveSignerParties(
  db: AuditDb,
  parsed: ParsedSigner[],
  userId: string | null,
): Promise<
  { ok: true; parties: ResolvedParty[] } | { ok: false; response: Response }
> {
  const wantsAgent = parsed.some((s) => (s.kind ?? "human") === "agent");
  if (!wantsAgent) {
    return {
      ok: true,
      parties: parsed.map((s) => ({
        name: s.name,
        email: s.email.trim().toLowerCase(),
        kind: "human" as const,
        agentId: null,
      })),
    };
  }

  if (!(await flagOn("agent_parties"))) {
    return {
      ok: false,
      response: jsonError(403, "Agent parties are disabled", "flag_off"),
    };
  }
  if (!userId) {
    return {
      ok: false,
      response: jsonError(403, "Pro plan required", "pro_required"),
    };
  }

  const cabinet = await cabinetForUser(db, userId);
  if (!cabinet.entitled) {
    return {
      ok: false,
      response: jsonError(403, "Pro plan required", "pro_required"),
    };
  }

  const ownerEmail = cabinet.ownerEmail?.trim().toLowerCase() ?? "";
  const parties: ResolvedParty[] = [];
  for (const s of parsed) {
    const kind = s.kind ?? "human";
    const email = s.email.trim().toLowerCase();
    if (kind !== "agent") {
      parties.push({ name: s.name, email, kind: "human", agentId: null });
      continue;
    }
    const slug = parseAgentSlug(s.agent);
    if (!slug) {
      return { ok: false, response: jsonError(400, "Unknown agent", "unknown_agent") };
    }
    const agent = await loadActiveAgentBySlug(db, cabinet.ownerUserId, slug);
    if (!agent) {
      return { ok: false, response: jsonError(400, "Unknown agent", "unknown_agent") };
    }
    if (!ownerEmail || email !== ownerEmail) {
      return {
        ok: false,
        response: jsonError(
          400,
          "Agent party email must match the agent owner's account",
          "invalid_request",
        ),
      };
    }
    parties.push({ name: s.name, email, kind: "agent", agentId: agent.id });
  }
  return { ok: true, parties };
}

function signerInsertValues(envelopeId: string, parties: ResolvedParty[]) {
  return parties.map((s, i) => ({
    envelopeId,
    name: s.name,
    email: s.email,
    signingOrder: i + 1,
    kind: s.kind,
    agentId: s.agentId,
    tokenHash: s.kind === "agent" ? null : placeholderSigningTokenHash(),
  }));
}

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function isPdf(bytes: Uint8Array, type: string): boolean {
  const magic =
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46;
  return magic || type === "application/pdf";
}

function requireDb(): AuditDb {
  return getDeps().db ?? getDb();
}

function requireStore(): BlobStore | null {
  return getDeps().store ?? null;
}

function requireMailer(): Mailer {
  return getDeps().mailer ?? createMailer();
}

function now(): Date {
  return getDeps().now?.() ?? new Date();
}

function hasApiKeyQuery(req: Request): boolean {
  return new URL(req.url).searchParams.has("apiKey");
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

async function inviteFirstSigner(
  db: AuditDb,
  mailer: Mailer,
  envelope: {
    id: string;
    senderEmail: string;
    title: string;
    expiresAt: Date;
    userId: string | null;
  },
  at: Date,
): Promise<string | null> {
  const signerRows = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.envelopeId, envelope.id));
  signerRows.sort((a, b) => a.signingOrder - b.signingOrder);
  const first = signerRows[0];
  if (!first) return null;
  if (first.kind === "agent") return null;
  const token = newSigningToken();
  const signUrl = `/s/${token.raw}`;
  await db
    .update(signersTable)
    .set({ tokenHash: token.hash })
    .where(eq(signersTable.id, first.id));
  const brand = await loadBrand(db, envelope.userId, requireStore());
  try {
    await mailer.sendMail({
      to: first.email,
      ...inviteEmail({
        signUrl,
        senderEmail: envelope.senderEmail,
        title: envelope.title,
        expiresAt: envelope.expiresAt,
        brand: {
          displayName: brand.displayName,
          hasLogo: Boolean(brand.logoBytes),
        },
      }),
      attachments: brandMailAttachments(brand.logoBytes),
    });
    await db
      .update(signersTable)
      .set({ sentAt: at })
      .where(eq(signersTable.id, first.id));
    await logEvent(db, {
      envelopeId: envelope.id,
      signerId: first.id,
      event: "sent",
    });
    await logEvent(db, {
      envelopeId: envelope.id,
      signerId: first.id,
      event: "emailed",
    });
  } catch (err) {
    await logEvent(db, {
      envelopeId: envelope.id,
      signerId: first.id,
      event: "emailed_failed",
      payload: { error: err instanceof Error ? err.message : "mail_failed" },
    });
  }
  return signUrl;
}

export async function sendPreparedPdf(opts: {
  title: string;
  senderEmail: string;
  userId: string;
  signers: ParsedSigner[];
  bytes: Uint8Array;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
}): Promise<Response> {
  const db = requireDb();
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const mailer = requireMailer();
  const at = now();
  const env = getEnv();
  const senderEmail = opts.senderEmail.trim().toLowerCase();
  const limit = Number(env.FREE_SEND_LIMIT);
  const windowDays = Number(env.FREE_SEND_WINDOW_DAYS);
  const windowStart = new Date(at.getTime() - windowDays * 86_400_000);

  const resolved = await resolveSignerParties(db, opts.signers, opts.userId);
  if (!resolved.ok) return resolved.response;

  const cabinet = await cabinetForUser(db, opts.userId);
  if (!cabinet.entitled) {
    const [cap] = await db
      .select({ n: count() })
      .from(envelopes)
      .where(
        and(
          or(
            eq(envelopes.userId, opts.userId),
            eq(envelopes.senderEmail, senderEmail),
          ),
          gte(envelopes.createdAt, windowStart),
          ne(envelopes.status, "pending_sender"),
        ),
      );
    if (Number(cap?.n ?? 0) >= limit) {
      return jsonError(429, "Send limit reached. Try again later.", "send_limit");
    }
  }

  const signingDays = Number(env.SIGNING_WINDOW_DAYS);
  const expiresAt = new Date(at.getTime() + signingDays * 86_400_000);
  const documentHash = sha256Hex(opts.bytes);
  const webhookUrl = opts.webhookUrl ?? null;
  const webhookSecret = opts.webhookSecret ?? null;

  let webhookSecretHash: string | null = null;
  if (webhookSecret) {
    try {
      webhookSecretHash = sealWebhookSecret(webhookSecret);
    } catch {
      return jsonError(503, "Webhook encryption is not configured", "webhook_unconfigured");
    }
  }

  const [envelope] = await db
    .insert(envelopes)
    .values({
      title: opts.title,
      senderEmail,
      userId: opts.userId,
      status: "pending",
      expiresAt,
      shredAt: expiresAt,
      sha256: documentHash,
      webhookUrl,
      webhookSecretHash,
      createdAt: at,
    })
    .returning();

  const storagePath = objectKey(envelope.id, "original");
  await store.put(storagePath, opts.bytes);
  await db.insert(documents).values({
    envelopeId: envelope.id,
    kind: "original",
    storagePath,
    documentHash,
  });
  await db.insert(signersTable).values(signerInsertValues(envelope.id, resolved.parties));

  const signUrl = await inviteFirstSigner(db, mailer, envelope, at);
  return Response.json(
    {
      id: envelope.id,
      status: "pending",
      ...(signUrl ? { signers: [{ sign_url: signUrl }] } : {}),
      ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
    },
    { status: 201 },
  );
}

export async function createEnvelope(req: Request): Promise<Response> {
  if (hasApiKeyQuery(req)) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Expected multipart form data", "invalid_request");
  }

  const title = String(form.get("title") ?? "").trim();
  let senderEmail = String(form.get("sender_email") ?? "").trim().toLowerCase();
  const signersField = form.get("signers");
  const file = form.get("file");

  if (!title) return jsonError(400, "Title is required", "invalid_request");
  if (!senderEmail) {
    return jsonError(400, "Sender email is required", "invalid_request");
  }

  let parsedSigners: z.infer<typeof signersSchema>;
  try {
    const raw =
      typeof signersField === "string" ? JSON.parse(signersField) : signersField;
    const parsed = signersSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "At least one signer is required", "missing_signers");
    }
    parsedSigners = parsed.data;
  } catch {
    return jsonError(400, "At least one signer is required", "missing_signers");
  }

  if (!(file instanceof Blob)) {
    return jsonError(400, "A PDF file is required", "invalid_pdf");
  }
  if (file.size > PDF_MAX_BYTES) {
    return jsonError(400, "PDF exceeds maximum size", "file_too_large");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdf(bytes, file.type)) {
    return jsonError(400, "File must be a PDF", "invalid_pdf");
  }

  const webhookField = String(form.get("webhook_url") ?? "").trim();
  let webhookUrl: string | null = null;
  let webhookSecret: string | null = null;
  if (webhookField) {
    const blocked = await webhookUrlError(webhookField);
    if (blocked) return jsonError(400, blocked, "invalid_webhook_url");
    webhookUrl = webhookField;
    webhookSecret = newWebhookSecret();
  }

  const db = requireDb();
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const mailer = requireMailer();
  const at = now();
  const env = getEnv();
  const limit = Number(env.FREE_SEND_LIMIT);
  const windowDays = Number(env.FREE_SEND_WINDOW_DAYS);
  const windowStart = new Date(at.getTime() - windowDays * 86_400_000);

  let liveUserId: string | null = null;
  const raw = bearerToken(req);
  if (raw) {
    if (raw.startsWith("sign_oauth_")) {
      const grant = await lookupOauthGrant(db, raw);
      if (!grant) return jsonError(401, "Unauthorized", "unauthorized");
      const account = await accountForOauthGrant(db, grant);
      if (!account) return jsonError(401, "Unauthorized", "unauthorized");
      liveUserId = account.id;
      senderEmail = account.email;
    } else if (raw.startsWith("sign_live_")) {
      const key = await lookupApiKey(db, raw);
      if (
        !key ||
        key.kind !== "live" ||
        !key.userId ||
        key.expiresAt.getTime() <= at.getTime()
      ) {
        return jsonError(401, "Unauthorized", "unauthorized");
      }
      liveUserId = key.userId;
      const [liveAccount] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, liveUserId));
      if (liveAccount?.email) {
        senderEmail = liveAccount.email.trim().toLowerCase();
      }
    } else {
      return jsonError(401, "Unauthorized", "unauthorized");
    }
  }

  if (liveUserId) {
    return sendPreparedPdf({
      title,
      senderEmail,
      userId: liveUserId,
      signers: parsedSigners,
      bytes,
      webhookUrl,
      webhookSecret,
    });
  }

  const resolved = await resolveSignerParties(db, parsedSigners, liveUserId);
  if (!resolved.ok) return resolved.response;

  const [cap] = await db
    .select({ n: count() })
    .from(envelopes)
    .where(
      and(
        eq(envelopes.senderEmail, senderEmail),
        gte(envelopes.createdAt, windowStart),
        ne(envelopes.status, "pending_sender"),
      ),
    );
  if (Number(cap?.n ?? 0) >= limit) {
    return jsonError(429, "Send limit reached. Try again later.", "send_limit");
  }

  const signingDays = Number(env.SIGNING_WINDOW_DAYS);
  const expiresAt = new Date(at.getTime() + signingDays * 86_400_000);
  const documentHash = sha256Hex(bytes);

  let webhookSecretHash: string | null = null;
  if (webhookSecret) {
    try {
      webhookSecretHash = sealWebhookSecret(webhookSecret);
    } catch {
      return jsonError(503, "Webhook encryption is not configured", "webhook_unconfigured");
    }
  }

  const [envelope] = await db
    .insert(envelopes)
    .values({
      title,
      senderEmail,
      userId: liveUserId,
      status: "pending_sender",
      expiresAt,
      shredAt: expiresAt,
      sha256: documentHash,
      webhookUrl,
      webhookSecretHash,
      createdAt: at,
    })
    .returning();

  const storagePath = objectKey(envelope.id, "original");
  await store.put(storagePath, bytes);
  await db.insert(documents).values({
    envelopeId: envelope.id,
    kind: "original",
    storagePath,
    documentHash,
  });

  await db.insert(signersTable).values(signerInsertValues(envelope.id, resolved.parties));

  const otp = await newOtp();
  await db.insert(otpChallenges).values({
    envelopeId: envelope.id,
    codeHash: otp.hash,
    expiresAt: new Date(at.getTime() + OTP_TTL_MS),
  });
  try {
    await mailer.sendMail({ to: senderEmail, ...otpEmail(otp.digits) });
    await logEvent(db, { envelopeId: envelope.id, event: "otp_sent" });
  } catch (err) {
    await logEvent(db, {
      envelopeId: envelope.id,
      event: "emailed_failed",
      payload: { error: err instanceof Error ? err.message : "mail_failed" },
    });
  }

  return Response.json(
    {
      id: envelope.id,
      status: "pending_sender",
      ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
    },
    { status: 201 },
  );
}

type EnvelopeRow = typeof envelopes.$inferSelect;
type ApiKeyRow = typeof apiKeys.$inferSelect;

type Authed =
  | {
      ok: true;
      db: AuditDb;
      envelope: EnvelopeRow;
      via: "key";
      key: ApiKeyRow;
      canDelete: boolean;
    }
  | {
      ok: true;
      db: AuditDb;
      envelope: EnvelopeRow;
      via: "session";
      user: AuthUser;
      canDelete: boolean;
    }
  | {
      ok: true;
      db: AuditDb;
      envelope: EnvelopeRow;
      via: "oauth";
      user: AuthUser;
      canDelete: boolean;
    }
  | { ok: false; response: Response };

async function cabinetAccess(
  db: AuditDb,
  envelopeUserId: string | null,
  callerId: string,
): Promise<{ sender: boolean; member: boolean; owner: boolean }> {
  if (!envelopeUserId) {
    return { sender: false, member: false, owner: false };
  }
  const cabinet = await cabinetForUser(db, envelopeUserId);
  return {
    sender: envelopeUserId === callerId,
    member: cabinet.memberUserIds.includes(callerId),
    owner: cabinet.ownerUserId === callerId,
  };
}

async function isSignerEmail(
  db: AuditDb,
  envelopeId: string,
  email: string | null | undefined,
): Promise<boolean> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  const [signed] = await db
    .select()
    .from(signersTable)
    .where(
      and(eq(signersTable.envelopeId, envelopeId), eq(signersTable.email, normalized)),
    );
  return Boolean(signed);
}

async function authorizeEnvelope(req: Request, envelopeId: string): Promise<Authed> {
  if (hasApiKeyQuery(req)) {
    return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
  }
  const db = requireDb();
  const raw = bearerToken(req);
  if (raw) {
    if (raw.startsWith("sign_oauth_")) {
      const grant = await lookupOauthGrant(db, raw);
      if (!grant) {
        return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
      }
      const account = await accountForOauthGrant(db, grant);
      if (!account) {
        return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
      }
      const [envelope] = await db.select().from(envelopes).where(eq(envelopes.id, envelopeId));
      if (!envelope) {
        return { ok: false, response: jsonError(404, "Envelope not found", "not_found") };
      }
      const access = await cabinetAccess(db, envelope.userId, account.id);
      let signed = false;
      if (!access.sender && !access.member) {
        signed = await isSignerEmail(db, envelopeId, account.email);
      }
      if (!access.sender && !access.member && !signed) {
        return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
      }
      return {
        ok: true,
        db,
        envelope,
        via: "oauth",
        user: { id: account.id, email: account.email },
        canDelete: access.sender || access.owner,
      };
    }
    if (!raw.startsWith("sign_tmp_") && !raw.startsWith("sign_live_")) {
      return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
    }
    const key = await lookupApiKey(db, raw);
    if (!key) {
      return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
    }
    if (key.kind === "tmp" && key.envelopeId !== envelopeId) {
      return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
    }
    const [envelope] = await db.select().from(envelopes).where(eq(envelopes.id, envelopeId));
    if (!envelope) {
      return { ok: false, response: jsonError(404, "Envelope not found", "not_found") };
    }
    if (key.kind === "live") {
      if (!key.userId) {
        return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
      }
      const access = await cabinetAccess(db, envelope.userId, key.userId);
      let signed = false;
      if (!access.sender && !access.member) {
        const [account] = await db
          .select()
          .from(accounts)
          .where(eq(accounts.userId, key.userId));
        signed = await isSignerEmail(db, envelopeId, account?.email);
      }
      if (!access.sender && !access.member && !signed) {
        return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
      }
      return {
        ok: true,
        db,
        envelope,
        via: "key",
        key,
        canDelete: access.sender || access.owner,
      };
    }
    return { ok: true, db, envelope, via: "key", key, canDelete: true };
  }

  const cookie = req.headers.get("cookie");
  if (!cookie) {
    return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
  }
  const user = await getAuth().userFromCookie(cookie);
  if (!user) {
    return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
  }
  await ensureAccount(db, user);
  await claimSends(db, user.id, user.email);
  const [envelope] = await db.select().from(envelopes).where(eq(envelopes.id, envelopeId));
  if (!envelope) {
    return { ok: false, response: jsonError(404, "Envelope not found", "not_found") };
  }
  const access = await cabinetAccess(db, envelope.userId, user.id);
  const signed =
    access.sender || access.member
      ? false
      : await isSignerEmail(db, envelopeId, user.email);
  if (!access.sender && !access.member && !signed) {
    return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
  }
  return {
    ok: true,
    db,
    envelope,
    via: "session",
    user,
    canDelete: access.sender || access.owner,
  };
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function agentSlugField(
  kind: "human" | "agent",
  agentId: string | null,
  slugById: Map<string, string>,
): { agent?: string } {
  if (kind !== "agent" || !agentId) return {};
  const slug = slugById.get(agentId);
  return slug ? { agent: slug } : {};
}

function keyExpired(authed: Extract<Authed, { ok: true }>): boolean {
  if (authed.via !== "key") return false;
  const keyDead = authed.key.expiresAt.getTime() <= now().getTime();
  if (authed.key.kind === "tmp") {
    return keyDead || authed.envelope.shredAt.getTime() <= now().getTime();
  }
  return keyDead;
}

export async function listEnvelopes(req: Request): Promise<Response> {
  if (hasApiKeyQuery(req)) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }
  const db = requireDb();
  const at = now();
  let userId: string | null = null;
  let email: string | null = null;

  const raw = bearerToken(req);
  if (raw) {
    if (raw.startsWith("sign_oauth_")) {
      const grant = await lookupOauthGrant(db, raw);
      if (!grant) return jsonError(401, "Unauthorized", "unauthorized");
      const account = await accountForOauthGrant(db, grant);
      if (!account) return jsonError(401, "Unauthorized", "unauthorized");
      userId = account.id;
      email = account.email;
      await claimSends(db, userId, email);
    } else if (raw.startsWith("sign_live_")) {
      const key = await lookupApiKey(db, raw);
      if (!key || key.kind !== "live" || !key.userId || key.expiresAt.getTime() <= at.getTime()) {
        return jsonError(401, "Unauthorized", "unauthorized");
      }
      userId = key.userId;
      const [account] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, key.userId));
      email = account?.email?.trim().toLowerCase() ?? null;
      if (email) await claimSends(db, userId, email);
    } else {
      return jsonError(401, "Unauthorized", "unauthorized");
    }
  } else {
    const cookie = req.headers.get("cookie");
    if (!cookie) return jsonError(401, "Unauthorized", "unauthorized");
    const user = await getAuth().userFromCookie(cookie);
    if (!user) return jsonError(401, "Unauthorized", "unauthorized");
    await ensureAccount(db, user);
    await claimSends(db, user.id, user.email);
    userId = user.id;
    email = user.email.trim().toLowerCase();
  }

  if (!userId) return jsonError(401, "Unauthorized", "unauthorized");
  const cabinet = await cabinetForUser(db, userId);
  const senderIds =
    cabinet.memberUserIds.length > 0 ? cabinet.memberUserIds : [userId];
  const sent = await db
    .select()
    .from(envelopes)
    .where(and(inArray(envelopes.userId, senderIds), ne(envelopes.status, "deleted")));
  const byId = new Map(sent.map((e) => [e.id, e]));
  if (email) {
    const signed = await db
      .select({ envelope: envelopes })
      .from(signersTable)
      .innerJoin(envelopes, eq(signersTable.envelopeId, envelopes.id))
      .where(
        and(eq(signersTable.email, email), ne(envelopes.status, "deleted")),
      );
    for (const row of signed) byId.set(row.envelope.id, row.envelope);
  }
  const rows = [...byId.values()].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const ownerUserId = cabinet.ownerUserId;
  return Response.json({
    envelopes: rows.map((e) => ({
      id: e.id,
      status: e.status,
      title: e.title,
      sender_email: e.senderEmail,
      created_at: e.createdAt.toISOString(),
      expires_at: e.expiresAt.toISOString(),
      shred_at: e.shredAt.toISOString(),
      can_delete: Boolean(
        (e.userId && e.userId === userId) ||
          (userId === ownerUserId &&
            e.userId &&
            cabinet.memberUserIds.includes(e.userId)),
      ),
    })),
  });
}

export async function getEnvelope(req: Request, envelopeId: string): Promise<Response> {
  if (!envelopeId) return jsonError(400, "Envelope id is required", "invalid_request");
  const authed = await authorizeEnvelope(req, envelopeId);
  if (!authed.ok) return authed.response;
  const { db, envelope } = authed;
  if (keyExpired(authed)) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }

  const signerRows = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.envelopeId, envelope.id));
  signerRows.sort((a, b) => a.signingOrder - b.signingOrder);

  const agentIds = [
    ...new Set(
      signerRows
        .map((s) => s.agentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const agentRows =
    agentIds.length === 0
      ? []
      : await db.select().from(agents).where(inArray(agents.id, agentIds));
  const slugById = new Map(agentRows.map((a) => [a.id, a.slug]));

  const currentIndex =
    envelope.status === "pending"
      ? signerRows.findIndex(
          (s) => !s.signedAt && !s.attestedAt && !s.declinedAt && !s.rejectedAt,
        )
      : -1;
  const current = currentIndex >= 0 ? signerRows[currentIndex] : null;
  const current_party = current
    ? {
        index: currentIndex,
        kind: current.kind,
        email: current.email,
        ...agentSlugField(current.kind, current.agentId, slugById),
      }
    : null;

  const auditRows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.envelopeId, envelope.id));
  auditRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return Response.json({
    id: envelope.id,
    status: envelope.status,
    title: envelope.title,
    expires_at: envelope.expiresAt.toISOString(),
    shred_at: envelope.shredAt.toISOString(),
    current_party,
    signers: signerRows.map((s) => ({
      kind: s.kind,
      email: s.email,
      ...agentSlugField(s.kind, s.agentId, slugById),
      sent_at: iso(s.sentAt),
      opened_at: iso(s.openedAt),
      consented_at: iso(s.consentedAt),
      signed_at: iso(s.signedAt),
      attested_at: iso(s.attestedAt),
      declined_at: iso(s.declinedAt),
      rejected_at: iso(s.rejectedAt),
      reminded_at: iso(s.remindedAt),
    })),
    audit: auditRows.map((a) => ({ event: a.event, at: a.createdAt.toISOString() })),
  });
}

export async function getEnvelopePdf(req: Request, envelopeId: string): Promise<Response> {
  if (!envelopeId) return jsonError(400, "Envelope id is required", "invalid_request");
  const authed = await authorizeEnvelope(req, envelopeId);
  if (!authed.ok) return authed.response;
  const { envelope } = authed;
  if (envelope.status === "deleted") {
    return jsonError(410, "Envelope has been deleted", "deleted");
  }
  if (keyExpired(authed)) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }
  if (envelope.status !== "completed") {
    return jsonError(409, "Envelope is not completed", "not_completed");
  }
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const kind =
    new URL(req.url).searchParams.get("kind") === "certificate"
      ? "certificate"
      : "sealed";
  const bytes = await store.get(objectKey(envelope.id, kind));
  if (!bytes) {
    return jsonError(410, "Envelope has been deleted", "deleted");
  }
  const filename =
    kind === "certificate" ? `${envelope.id}-certificate.pdf` : `${envelope.id}.pdf`;
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function deleteEnvelope(req: Request, envelopeId: string): Promise<Response> {
  if (!envelopeId) return jsonError(400, "Envelope id is required", "invalid_request");
  const authed = await authorizeEnvelope(req, envelopeId);
  if (!authed.ok) return authed.response;
  if (!authed.canDelete) {
    return jsonError(403, "Signers cannot void this envelope", "forbidden");
  }
  const { db, envelope } = authed;
  if (keyExpired(authed)) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }
  if (envelope.status === "deleted") {
    return jsonError(409, "Envelope is already deleted", "invalid_state");
  }
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const at = now();
  await purgeEnvelope(db, store, envelope.id, at, { force: true });
  return Response.json({ id: envelope.id, status: "deleted", message: "Void." });
}
