import { and, count, eq, gte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import {
  accounts,
  apiKeys,
  auditEvents,
  documents,
  envelopes,
  otpChallenges,
  signers as signersTable,
} from "../db/schema.js";
import { logEvent, type AuditDb } from "../lib/audit.js";
import type { AuthUser } from "../lib/auth/supabase.js";
import { getAuth } from "../lib/auth/supabase.js";
import { getDeps } from "../lib/deps.js";
import { createMailer, inviteEmail, otpEmail, type Mailer } from "../lib/email.js";
import { sha256Hex } from "../lib/hash.js";
import {
  claimSends,
  ensureAccount,
  lookupApiKey,
} from "../lib/keys.js";
import { newOtp } from "../lib/otp.js";
import { objectKey, type BlobStore } from "../lib/storage.js";
import { newSigningToken } from "../lib/tokens.js";
import { newWebhookSecret, webhookUrlError } from "../lib/webhooks.js";
import { getEnv } from "../env.js";
import { purgeEnvelope } from "../jobs/shred.js";

const PDF_MAX_BYTES = 20 * 1024 * 1024;
const OTP_TTL_MS = 10 * 60 * 1000;

const signerSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
});
const signersSchema = z.array(signerSchema).min(1);

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

function requireStore(): BlobStore {
  const store = getDeps().store;
  if (!store) throw new Error("store is not configured");
  return store;
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
  },
  at: Date,
): Promise<void> {
  const signerRows = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.envelopeId, envelope.id));
  signerRows.sort((a, b) => a.signingOrder - b.signingOrder);
  const first = signerRows[0];
  if (!first) return;
  const token = newSigningToken();
  const signUrl = `/s/${token.raw}`;
  await db
    .update(signersTable)
    .set({ tokenHash: token.hash, sentAt: at })
    .where(eq(signersTable.id, first.id));
  await mailer.sendMail({
    to: first.email,
    ...inviteEmail({
      signUrl,
      senderEmail: envelope.senderEmail,
      title: envelope.title,
      expiresAt: envelope.expiresAt,
    }),
  });
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
  const senderEmail = String(form.get("sender_email") ?? "").trim().toLowerCase();
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
  let webhookSecret: { raw: string; hash: string } | null = null;
  if (webhookField) {
    const blocked = webhookUrlError(webhookField);
    if (blocked) return jsonError(400, blocked, "invalid_webhook_url");
    webhookUrl = webhookField;
    webhookSecret = newWebhookSecret();
  }

  const db = requireDb();
  const store = requireStore();
  const mailer = requireMailer();
  const at = now();
  const env = getEnv();
  const limit = Number(env.FREE_SEND_LIMIT);
  const windowDays = Number(env.FREE_SEND_WINDOW_DAYS);
  const windowStart = new Date(at.getTime() - windowDays * 86_400_000);

  let liveUserId: string | null = null;
  const raw = bearerToken(req);
  if (raw) {
    if (!raw.startsWith("sign_live_")) {
      return jsonError(401, "Unauthorized", "unauthorized");
    }
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
  }

  if (liveUserId) {
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, liveUserId));
    if (account?.plan !== "pro") {
      const [cap] = await db
        .select({ n: count() })
        .from(envelopes)
        .where(
          and(
            or(
              eq(envelopes.userId, liveUserId),
              eq(envelopes.senderEmail, senderEmail),
            ),
            ne(envelopes.status, "deleted"),
            gte(envelopes.createdAt, windowStart),
          ),
        );
      if (Number(cap?.n ?? 0) >= limit) {
        return jsonError(429, "Send limit reached. Try again later.", "send_limit");
      }
    }
  } else {
    const [cap] = await db
      .select({ n: count() })
      .from(envelopes)
      .where(
        and(
          eq(envelopes.senderEmail, senderEmail),
          ne(envelopes.status, "deleted"),
          gte(envelopes.createdAt, windowStart),
        ),
      );
    if (Number(cap?.n ?? 0) >= limit) {
      return jsonError(429, "Send limit reached. Try again later.", "send_limit");
    }
  }

  const signingDays = Number(env.SIGNING_WINDOW_DAYS);
  const expiresAt = new Date(at.getTime() + signingDays * 86_400_000);
  const documentHash = sha256Hex(bytes);
  const live = Boolean(liveUserId);

  const [envelope] = await db
    .insert(envelopes)
    .values({
      title,
      senderEmail,
      userId: liveUserId,
      status: live ? "pending" : "pending_sender",
      expiresAt,
      shredAt: expiresAt,
      sha256: documentHash,
      webhookUrl,
      webhookSecretHash: webhookSecret?.raw ?? null,
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

  await db.insert(signersTable).values(
    parsedSigners.map((s, i) => ({
      envelopeId: envelope.id,
      name: s.name,
      email: s.email.trim().toLowerCase(),
      signingOrder: i + 1,
      tokenHash: sha256Hex(`pending:${envelope.id}:${i}`),
    })),
  );

  if (live) {
    await inviteFirstSigner(db, mailer, envelope, at);
    return Response.json(
      {
        id: envelope.id,
        status: "pending",
        ...(webhookSecret ? { webhook_secret: webhookSecret.raw } : {}),
      },
      { status: 201 },
    );
  }

  const otp = await newOtp();
  await db.insert(otpChallenges).values({
    envelopeId: envelope.id,
    codeHash: otp.hash,
    expiresAt: new Date(at.getTime() + OTP_TTL_MS),
  });
  await mailer.sendMail({ to: senderEmail, ...otpEmail(otp.digits) });
  await logEvent(db, { envelopeId: envelope.id, event: "otp_sent" });

  return Response.json(
    {
      id: envelope.id,
      status: "pending_sender",
      ...(webhookSecret ? { webhook_secret: webhookSecret.raw } : {}),
    },
    { status: 201 },
  );
}

type EnvelopeRow = typeof envelopes.$inferSelect;
type ApiKeyRow = typeof apiKeys.$inferSelect;

type Authed =
  | { ok: true; db: AuditDb; envelope: EnvelopeRow; via: "key"; key: ApiKeyRow }
  | {
      ok: true;
      db: AuditDb;
      envelope: EnvelopeRow;
      via: "session";
      user: AuthUser;
      canDelete: boolean;
    }
  | { ok: false; response: Response };

async function authorizeEnvelope(req: Request, envelopeId: string): Promise<Authed> {
  if (hasApiKeyQuery(req)) {
    return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
  }
  const db = requireDb();
  const raw = bearerToken(req);
  if (raw) {
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
      if (!key.userId || !envelope.userId || key.userId !== envelope.userId) {
        return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
      }
    }
    return { ok: true, db, envelope, via: "key", key };
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
  const canDelete = Boolean(envelope.userId && envelope.userId === user.id);
  const [signed] = await db
    .select()
    .from(signersTable)
    .where(
      and(
        eq(signersTable.envelopeId, envelopeId),
        eq(signersTable.email, user.email.trim().toLowerCase()),
      ),
    );
  if (!canDelete && !signed) {
    return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
  }
  return { ok: true, db, envelope, via: "session", user, canDelete };
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function keyExpired(authed: Extract<Authed, { ok: true }>): boolean {
  return authed.via === "key" && authed.key.expiresAt.getTime() <= now().getTime();
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
    if (!raw.startsWith("sign_live_")) {
      return jsonError(401, "Unauthorized", "unauthorized");
    }
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

  const sent = await db
    .select()
    .from(envelopes)
    .where(and(eq(envelopes.userId, userId), ne(envelopes.status, "deleted")));
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
  return Response.json({
    envelopes: rows.map((e) => ({
      id: e.id,
      status: e.status,
      title: e.title,
      sender_email: e.senderEmail,
      created_at: e.createdAt.toISOString(),
      expires_at: e.expiresAt.toISOString(),
      shred_at: e.shredAt.toISOString(),
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
    signers: signerRows.map((s) => ({
      email: s.email,
      sent_at: iso(s.sentAt),
      opened_at: iso(s.openedAt),
      consented_at: iso(s.consentedAt),
      signed_at: iso(s.signedAt),
      declined_at: iso(s.declinedAt),
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
  const bytes = await store.get(objectKey(envelope.id, "sealed"));
  if (!bytes) {
    return jsonError(410, "Envelope has been deleted", "deleted");
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${envelope.id}.pdf"`,
    },
  });
}

export async function deleteEnvelope(req: Request, envelopeId: string): Promise<Response> {
  if (!envelopeId) return jsonError(400, "Envelope id is required", "invalid_request");
  const authed = await authorizeEnvelope(req, envelopeId);
  if (!authed.ok) return authed.response;
  if (authed.via === "session" && !authed.canDelete) {
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
  const at = now();
  await purgeEnvelope(db, store, envelope.id, at);
  return Response.json({ id: envelope.id, status: "deleted", message: "Void." });
}
