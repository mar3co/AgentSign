import { and, count, eq, gte, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import {
  documents,
  envelopes,
  otpChallenges,
  signers as signersTable,
} from "../db/schema.js";
import { logEvent } from "../lib/audit.js";
import { getDeps } from "../lib/deps.js";
import { createMailer, otpEmail, type Mailer } from "../lib/email.js";
import { sha256Hex } from "../lib/hash.js";
import { newOtp } from "../lib/otp.js";
import { objectKey, type BlobStore } from "../lib/storage.js";
import { getEnv } from "../env.js";

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

function requireDb() {
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
