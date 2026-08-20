import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import {
  accounts,
  documents,
  envelopes,
  signers as signersTable,
} from "../db/schema.js";
import { getEnv } from "../env.js";
import { logEvent, type AuditDb } from "../lib/audit.js";
import { getDeps } from "../lib/deps.js";
import { stubMailer, type Mailer } from "../lib/email.js";
import { sha256Hex } from "../lib/hash.js";
import { completeEnvelopePdf } from "../lib/pdf/complete.js";
import { loadSigningP12 } from "../lib/pdf/devP12.js";
import { objectKey, type BlobStore } from "../lib/storage.js";
import { hashSigningToken } from "../lib/tokens.js";

export const CONSENT_TEXT =
  "I agree to sign this document electronically. I consent to receiving and storing records electronically. My signature is intended to be as binding as a handwritten signature under applicable law, including ESIGN and UETA. This is not legal advice. This is not a notary service.";

const consentSchema = z.object({
  consent: z.literal(true),
});

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
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
  return getDeps().mailer ?? stubMailer;
}

function now(): Date {
  return getDeps().now?.() ?? new Date();
}

function clientIp(req: Request): string | undefined {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("cf-connecting-ip") ?? undefined;
}

function signingP12(): { p12: Buffer; passphrase: string } {
  const deps = getDeps();
  if (deps.p12 && deps.p12Passphrase != null) {
    return { p12: deps.p12, passphrase: deps.p12Passphrase };
  }
  return loadSigningP12();
}

/** Task 17 implements HMAC delivery; no-op until then. */
async function fireEnvelopeCompleted(_payload: {
  event: "envelope.completed";
  id: string;
  status: string;
  sha256: string;
  shred_at: Date;
}): Promise<void> {}

type SignerRow = typeof signersTable.$inferSelect;
type EnvelopeRow = typeof envelopes.$inferSelect;

type Loaded =
  | { ok: true; db: AuditDb; signer: SignerRow; envelope: EnvelopeRow }
  | { ok: false; error: Response };

async function loadSigner(token: string): Promise<Loaded> {
  if (!token) return { ok: false, error: jsonError(404, "Not found", "not_found") };
  const db = requireDb();
  const [signer] = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.tokenHash, hashSigningToken(token)));
  if (!signer) return { ok: false, error: jsonError(404, "Not found", "not_found") };
  const [envelope] = await db
    .select()
    .from(envelopes)
    .where(eq(envelopes.id, signer.envelopeId));
  if (!envelope) return { ok: false, error: jsonError(404, "Not found", "not_found") };
  return { ok: true, db, signer, envelope };
}

async function sequentialWait(
  db: AuditDb,
  signer: SignerRow,
): Promise<Response | null> {
  if (signer.signingOrder <= 1) return null;
  const [prev] = await db
    .select()
    .from(signersTable)
    .where(
      and(
        eq(signersTable.envelopeId, signer.envelopeId),
        eq(signersTable.signingOrder, signer.signingOrder - 1),
      ),
    );
  if (prev && !prev.signedAt) {
    return jsonError(409, "Waiting on previous signer.", "sequential_wait");
  }
  return null;
}

export async function getSigningState(
  token: string,
  req?: Request,
): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { db, signer, envelope } = loaded;
  const at = now();

  if (!signer.signedAt && envelope.expiresAt.getTime() <= at.getTime()) {
    return jsonError(410, "This link has expired", "expired");
  }

  const wait = await sequentialWait(db, signer);
  if (wait && !signer.signedAt) return wait;

  if (!signer.openedAt) {
    await db
      .update(signersTable)
      .set({ openedAt: at })
      .where(eq(signersTable.id, signer.id));
    await logEvent(db, {
      envelopeId: envelope.id,
      signerId: signer.id,
      event: "opened",
      ip: req ? clientIp(req) : undefined,
      ua: req?.headers.get("user-agent") ?? undefined,
    });
  }

  return Response.json({
    title: envelope.title,
    signerName: signer.name,
    signerEmail: signer.email,
    sequentialWait: false,
    expiresAt: envelope.expiresAt.toISOString(),
    shredAt: envelope.shredAt.toISOString(),
    signed: Boolean(signer.signedAt),
    declined: Boolean(signer.declinedAt),
  });
}

export async function postConsent(
  req: Request,
  token: string,
): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { db, signer, envelope } = loaded;
  const at = now();

  if (envelope.expiresAt.getTime() <= at.getTime()) {
    return jsonError(410, "This link has expired", "expired");
  }
  if (envelope.status !== "pending" || signer.declinedAt || signer.signedAt) {
    return jsonError(409, "Envelope is not awaiting signature", "invalid_state");
  }
  const wait = await sequentialWait(db, signer);
  if (wait) return wait;

  try {
    consentSchema.parse(await req.json());
  } catch {
    return jsonError(400, "Consent is required", "consent_required");
  }

  const ip = clientIp(req) ?? null;
  const ua = req.headers.get("user-agent");
  await db
    .update(signersTable)
    .set({ consentedAt: at, consentUa: ua, ip })
    .where(eq(signersTable.id, signer.id));
  await logEvent(db, {
    envelopeId: envelope.id,
    signerId: signer.id,
    event: "consented",
    ip: ip ?? undefined,
    ua: ua ?? undefined,
  });
  return Response.json({ ok: true });
}

export async function postSign(req: Request, token: string): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { db, signer, envelope } = loaded;
  const at = now();
  const store = requireStore();

  if (envelope.expiresAt.getTime() <= at.getTime() && envelope.status === "pending") {
    return jsonError(410, "This link has expired", "expired");
  }
  if (envelope.status !== "pending" || signer.declinedAt || signer.signedAt) {
    return jsonError(409, "Envelope is not awaiting signature", "invalid_state");
  }
  const wait = await sequentialWait(db, signer);
  if (wait) return wait;
  if (!signer.consentedAt) {
    return jsonError(400, "Consent is required before signing", "consent_required");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Expected multipart form data", "invalid_request");
  }
  const file = form.get("png");
  if (!(file instanceof Blob)) {
    return jsonError(400, "A PNG signature is required", "invalid_png");
  }
  const png = new Uint8Array(await file.arrayBuffer());

  const ip = clientIp(req) ?? signer.ip;
  const ua = req.headers.get("user-agent") ?? signer.ua;

  const allSigners = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.envelopeId, envelope.id));
  allSigners.sort((a, b) => a.signingOrder - b.signingOrder);
  const last = allSigners.every((s) => s.id === signer.id || s.signedAt);

  if (last) {
    const original = await store.get(objectKey(envelope.id, "original"));
    if (!original) {
      return jsonError(500, "Original document missing", "missing_original");
    }
    const { p12, passphrase } = signingP12();
    let result: Awaited<ReturnType<typeof completeEnvelopePdf>>;
    try {
      result = await completeEnvelopePdf({
        original,
        appearance: {
          png,
          name: signer.name,
          email: signer.email,
          signedAt: at,
        },
        p12,
        passphrase,
        meta: {
          envelopeId: envelope.id,
          title: envelope.title,
          senderEmail: envelope.senderEmail,
          consentText: CONSENT_TEXT,
          signers: allSigners.map((s) => ({
            name: s.name,
            email: s.email,
            sentAt: s.sentAt,
            openedAt: s.openedAt,
            consentedAt: s.id === signer.id ? s.consentedAt ?? at : s.consentedAt,
            signedAt: s.id === signer.id ? at : s.signedAt,
            declinedAt: s.declinedAt,
            ip: s.id === signer.id ? ip : s.ip,
            ua: s.id === signer.id ? ua : s.ua,
          })),
        },
      });
    } catch {
      return jsonError(500, "Failed to complete envelope", "complete_failed");
    }

    let keepDays = Number(getEnv().FREE_KEEP_DAYS);
    if (envelope.userId) {
      const [account] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, envelope.userId));
      if (account?.plan === "pro") keepDays = Number(getEnv().PRO_KEEP_DAYS);
    }
    const shredAt = new Date(at.getTime() + keepDays * 86_400_000);
    const sealedPath = objectKey(envelope.id, "sealed");
    const certPath = objectKey(envelope.id, "certificate");
    await store.put(sealedPath, result.sealed);
    await store.put(certPath, result.certificate);

    await db
      .update(signersTable)
      .set({ signedAt: at, ip, ua })
      .where(eq(signersTable.id, signer.id));
    await db
      .update(envelopes)
      .set({ status: "completed", sha256: result.sha256, shredAt })
      .where(eq(envelopes.id, envelope.id));
    await db.insert(documents).values([
      {
        envelopeId: envelope.id,
        kind: "sealed",
        storagePath: sealedPath,
        documentHash: result.sha256,
      },
      {
        envelopeId: envelope.id,
        kind: "certificate",
        storagePath: certPath,
        documentHash: sha256Hex(result.certificate),
      },
    ]);
    await logEvent(db, {
      envelopeId: envelope.id,
      signerId: signer.id,
      event: "signed",
      ip: ip ?? undefined,
      ua: ua ?? undefined,
    });
    await fireEnvelopeCompleted({
      event: "envelope.completed",
      id: envelope.id,
      status: "completed",
      sha256: result.sha256,
      shred_at: shredAt,
    });
    return Response.json({
      status: "completed",
      shred_at: shredAt.toISOString(),
      sha256: result.sha256,
    });
  }

  await db
    .update(signersTable)
    .set({ signedAt: at, ip, ua })
    .where(eq(signersTable.id, signer.id));
  await logEvent(db, {
    envelopeId: envelope.id,
    signerId: signer.id,
    event: "signed",
    ip: ip ?? undefined,
    ua: ua ?? undefined,
  });
  return Response.json({ status: "pending" });
}

export async function postDecline(
  req: Request,
  token: string,
): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { db, signer, envelope } = loaded;
  const at = now();
  const mailer = requireMailer();

  if (envelope.expiresAt.getTime() <= at.getTime() && envelope.status === "pending") {
    return jsonError(410, "This link has expired", "expired");
  }
  if (signer.signedAt) {
    return jsonError(409, "Already signed", "invalid_state");
  }
  if (envelope.status !== "pending") {
    return jsonError(409, "Envelope is not awaiting signature", "invalid_state");
  }
  const wait = await sequentialWait(db, signer);
  if (wait) return wait;

  let reason: string | undefined;
  try {
    const body: unknown = await req.json();
    if (
      body &&
      typeof body === "object" &&
      "reason" in body &&
      typeof (body as { reason: unknown }).reason === "string"
    ) {
      reason = (body as { reason: string }).reason;
    }
  } catch {
    // optional JSON body
  }

  const ip = clientIp(req);
  const ua = req.headers.get("user-agent") ?? undefined;
  await db
    .update(signersTable)
    .set({ declinedAt: at })
    .where(eq(signersTable.id, signer.id));
  await db
    .update(envelopes)
    .set({ status: "declined" })
    .where(eq(envelopes.id, envelope.id));
  await logEvent(db, {
    envelopeId: envelope.id,
    signerId: signer.id,
    event: "declined",
    ip,
    ua,
    payload: reason ? { reason } : undefined,
  });
  await mailer.sendMail({
    to: envelope.senderEmail,
    subject: `${signer.name} declined to sign ${envelope.title}`,
    text: reason
      ? `${signer.name} declined to sign "${envelope.title}". Reason: ${reason}`
      : `${signer.name} declined to sign "${envelope.title}".`,
  });
  return Response.json({ status: "declined" });
}
