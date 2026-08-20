import { and, count, eq, gte, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import {
  apiKeys,
  auditEvents,
  documents,
  envelopes,
  otpChallenges,
  signers as signersTable,
} from "../db/schema.js";
import { logEvent, type AuditDb } from "../lib/audit.js";
import { getDeps } from "../lib/deps.js";
import { createMailer, otpEmail, type Mailer } from "../lib/email.js";
import { equalHex, sha256Hex } from "../lib/hash.js";
import { newOtp } from "../lib/otp.js";
import { objectKey, type BlobStore } from "../lib/storage.js";
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

export async function createEnvelope(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Expected multipart form data", "invalid_request");
  }

  const title = String(form.get("title") ?? "").trim();
  const senderEmail = String(form.get("sender_email") ?? "").trim();
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

  const db = requireDb();
  const store = requireStore();
  const mailer = requireMailer();
  const at = now();
  const env = getEnv();
  const limit = Number(env.FREE_SEND_LIMIT);
  const windowDays = Number(env.FREE_SEND_WINDOW_DAYS);
  const windowStart = new Date(at.getTime() - windowDays * 86_400_000);

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

  const signingDays = Number(env.SIGNING_WINDOW_DAYS);
  const expiresAt = new Date(at.getTime() + signingDays * 86_400_000);
  const documentHash = sha256Hex(bytes);

  const [envelope] = await db
    .insert(envelopes)
    .values({
      title,
      senderEmail,
      status: "pending_sender",
      expiresAt,
      shredAt: expiresAt,
      sha256: documentHash,
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
      email: s.email,
      signingOrder: i + 1,
      tokenHash: sha256Hex(`pending:${envelope.id}:${i}`),
    })),
  );

  const otp = await newOtp();
  await db.insert(otpChallenges).values({
    envelopeId: envelope.id,
    codeHash: otp.hash,
    expiresAt: new Date(at.getTime() + OTP_TTL_MS),
  });
  await mailer.sendMail({ to: senderEmail, ...otpEmail(otp.digits) });
  await logEvent(db, { envelopeId: envelope.id, event: "otp_sent" });

  return Response.json(
    { id: envelope.id, status: "pending_sender" },
    { status: 201 },
  );
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

type EnvelopeRow = typeof envelopes.$inferSelect;
type ApiKeyRow = typeof apiKeys.$inferSelect;

type Authed =
  | { ok: true; db: AuditDb; envelope: EnvelopeRow; key: ApiKeyRow }
  | { ok: false; response: Response };

async function authorizeEnvelope(req: Request, envelopeId: string): Promise<Authed> {
  const raw = bearerToken(req);
  if (!raw || (!raw.startsWith("sign_tmp_") && !raw.startsWith("sign_live_"))) {
    return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
  }
  const db = requireDb();
  const hash = sha256Hex(raw);
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.tokenHash, hash));
  if (!key || !equalHex(key.tokenHash, hash)) {
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
  return { ok: true, db, envelope, key };
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export async function getEnvelope(req: Request, envelopeId: string): Promise<Response> {
  if (!envelopeId) return jsonError(400, "Envelope id is required", "invalid_request");
  const authed = await authorizeEnvelope(req, envelopeId);
  if (!authed.ok) return authed.response;
  const { db, envelope, key } = authed;
  if (key.expiresAt.getTime() <= now().getTime()) {
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
  const { envelope, key } = authed;
  if (envelope.status === "deleted") {
    return jsonError(410, "Envelope has been deleted", "deleted");
  }
  if (key.expiresAt.getTime() <= now().getTime()) {
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
  const { db, envelope, key } = authed;
  if (key.expiresAt.getTime() <= now().getTime()) {
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
