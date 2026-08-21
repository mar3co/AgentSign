import { and, eq, inArray } from "drizzle-orm";
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
import { loadBrand, parseLogo } from "../lib/branding.js";
import { cabinetForUser } from "../lib/cabinet.js";
import { getDeps, storeUnavailableResponse } from "../lib/deps.js";
import {
  brandMailAttachments,
  completionAttachments,
  completionEmail,
  createMailer,
  declineEmail,
  inviteEmail,
  type Mailer,
} from "../lib/email.js";
import { sha256Hex } from "../lib/hash.js";
import { completeEnvelopePdf } from "../lib/pdf/complete.js";
import { loadSigningP12 } from "../lib/pdf/devP12.js";
import type { SignatureAppearance } from "../lib/pdf/appendSignaturePage.js";
import { appearanceKey, objectKey, type BlobStore } from "../lib/storage.js";
import { hashSigningToken, newSigningToken } from "../lib/tokens.js";
import { fireEnvelopeCompleted } from "../lib/webhooks.js";
import { syncTmpKeyExpiry } from "../lib/keys.js";

export const CONSENT_TEXT =
  "I agree to sign this document electronically. I consent to receiving and storing records electronically. My signature is intended to be as binding as a handwritten signature under applicable law, including ESIGN and UETA. This is not legal advice. This is not a notary service.";

const consentSchema = z.object({
  consent: z.literal(true),
});

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
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

  if (envelope.status === "deleted") {
    return jsonError(410, "This link has expired", "deleted");
  }

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

  let display_name: string | null = null;
  let has_logo = false;
  if (envelope.userId) {
    const cabinet = await cabinetForUser(db, envelope.userId);
    display_name = cabinet.displayName;
    has_logo = Boolean(cabinet.logoPath);
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
    status: envelope.status,
    display_name,
    has_logo,
  });
}

export async function getCeremonyLogo(
  _req: Request,
  token: string,
): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { db, signer, envelope } = loaded;
  if (envelope.status === "deleted") {
    return jsonError(410, "This link has expired", "deleted");
  }
  if (!signer.signedAt && envelope.expiresAt.getTime() <= now().getTime()) {
    return jsonError(410, "This link has expired", "expired");
  }
  if (!envelope.userId) {
    return jsonError(404, "Not found", "not_found");
  }
  const cabinet = await cabinetForUser(db, envelope.userId);
  if (!cabinet.logoPath) {
    return jsonError(404, "Not found", "not_found");
  }
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const bytes = await store.get(cabinet.logoPath);
  if (!bytes) {
    return jsonError(404, "Not found", "not_found");
  }
  const parsed = parseLogo(bytes);
  if (!parsed.ok) {
    return jsonError(404, "Not found", "not_found");
  }
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: { "content-type": parsed.contentType },
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
  if (!store) return storeUnavailableResponse();

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
  if (png.byteLength > 1_000_000 || !isPng(png)) {
    return jsonError(400, "A PNG signature is required", "invalid_png");
  }

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
    const appearances: SignatureAppearance[] = [];
    for (const s of allSigners) {
      if (s.id === signer.id) {
        appearances.push({
          png,
          name: signer.name,
          email: signer.email,
          signedAt: at,
        });
        continue;
      }
      if (!s.signedAt) continue;
      const prior = await store.get(appearanceKey(envelope.id, s.id));
      if (!prior) {
        return jsonError(500, "Prior signature missing", "missing_appearance");
      }
      appearances.push({
        png: prior,
        name: s.name,
        email: s.email,
        signedAt: s.signedAt,
      });
    }
    await store.put(appearanceKey(envelope.id, signer.id), png);
    let result: Awaited<ReturnType<typeof completeEnvelopePdf>>;
    try {
      const { p12, passphrase } = signingP12();
      result = await completeEnvelopePdf({
        original,
        appearances,
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
    const proDays = Number(getEnv().PRO_KEEP_DAYS);
    if (envelope.userId) {
      const [account] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, envelope.userId));
      if (account?.plan === "pro") keepDays = proDays;
    }
    const emails = new Set(
      allSigners.map((s) => s.email.trim().toLowerCase()).filter(Boolean),
    );
    if (emails.size > 0) {
      const signerAccounts = await db
        .select()
        .from(accounts)
        .where(inArray(accounts.email, [...emails]));
      if (signerAccounts.some((a) => a.plan === "pro")) keepDays = proDays;
    }
    const shredAt = new Date(at.getTime() + keepDays * 86_400_000);
    const sealedPath = objectKey(envelope.id, "sealed");
    const certPath = objectKey(envelope.id, "certificate");
    await store.put(sealedPath, result.sealed);
    await store.put(certPath, result.certificate);

    try {
      await db.transaction(async (tx) => {
        await tx
          .update(signersTable)
          .set({ signedAt: at, ip, ua })
          .where(eq(signersTable.id, signer.id));
        const [updated] = await tx
          .update(envelopes)
          .set({ status: "completed", sha256: result.sha256, shredAt })
          .where(and(eq(envelopes.id, envelope.id), eq(envelopes.status, "pending")))
          .returning();
        if (!updated) throw new Error("complete_conflict");
        await tx.insert(documents).values([
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
      });
    } catch {
      return jsonError(409, "Envelope is not awaiting signature", "invalid_state");
    }
    await logEvent(db, {
      envelopeId: envelope.id,
      signerId: signer.id,
      event: "signed",
      ip: ip ?? undefined,
      ua: ua ?? undefined,
    });
    try {
      await syncTmpKeyExpiry(db, envelope.id, shredAt);
    } catch {
      // envelope is already completed
    }

    const mailer = requireMailer();
    const docs = completionAttachments(result.sealed, result.certificate);
    const brand = await loadBrand(db, envelope.userId, store);
    const logo = brandMailAttachments(brand.logoBytes);
    const attachments = [...(docs ?? []), ...(logo ?? [])];
    const recipients = new Set<string>([
      envelope.senderEmail,
      ...allSigners.map((s) => s.email),
    ]);
    for (const to of recipients) {
      try {
        const body = completionEmail({
          to,
          title: envelope.title,
          shredAt,
          includeAttachments: Boolean(docs),
          senderEmail: envelope.senderEmail,
          brand: {
            displayName: brand.displayName,
            hasLogo: Boolean(brand.logoBytes),
          },
        });
        await mailer.sendMail({
          to,
          subject: body.subject,
          text: body.text,
          html: body.html,
          attachments: attachments.length ? attachments : undefined,
        });
        await logEvent(db, {
          envelopeId: envelope.id,
          event: "emailed",
          payload: { to, kind: "completion" },
        });
      } catch (err) {
        await logEvent(db, {
          envelopeId: envelope.id,
          event: "emailed_failed",
          payload: {
            to,
            error: err instanceof Error ? err.message : "mail_failed",
          },
        });
      }
    }

    try {
      await fireEnvelopeCompleted(
        db,
        envelope,
        {
          event: "envelope.completed",
          id: envelope.id,
          status: "completed",
          sha256: result.sha256,
          shred_at: shredAt,
        },
      );
    } catch (err) {
      await logEvent(db, {
        envelopeId: envelope.id,
        event: "webhook_failed",
        payload: { error: err instanceof Error ? err.message : "webhook_failed" },
      });
    }
    return Response.json({
      status: "completed",
      shred_at: shredAt.toISOString(),
      sha256: result.sha256,
    });
  }

  await store.put(appearanceKey(envelope.id, signer.id), png);

  const next = allSigners.find((s) => s.signingOrder === signer.signingOrder + 1);
  // First mint + invite only; never rotate a token that was already sent.
  if (next && !next.signedAt && !next.declinedAt && !next.sentAt) {
    const mailer = requireMailer();
    const token = newSigningToken();
    const signUrl = `/s/${token.raw}`;
    await db
      .update(signersTable)
      .set({ tokenHash: token.hash })
      .where(eq(signersTable.id, next.id));
    const brand = await loadBrand(db, envelope.userId, store);
    const invite = inviteEmail({
      signUrl,
      senderEmail: envelope.senderEmail,
      title: envelope.title,
      expiresAt: envelope.expiresAt,
      brand: {
        displayName: brand.displayName,
        hasLogo: Boolean(brand.logoBytes),
      },
    });
    try {
      await mailer.sendMail({
        to: next.email,
        ...invite,
        attachments: brandMailAttachments(brand.logoBytes),
      });
      await db
        .update(signersTable)
        .set({ sentAt: at })
        .where(eq(signersTable.id, next.id));
      await logEvent(db, {
        envelopeId: envelope.id,
        signerId: next.id,
        event: "sent",
      });
      await logEvent(db, {
        envelopeId: envelope.id,
        signerId: next.id,
        event: "emailed",
      });
    } catch (err) {
      await logEvent(db, {
        envelopeId: envelope.id,
        signerId: next.id,
        event: "emailed_failed",
        payload: { error: err instanceof Error ? err.message : "mail_failed" },
      });
      return jsonError(503, "Could not email the next signer", "invite_failed");
    }
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

export async function getCeremonyPdf(req: Request, token: string): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { signer, envelope } = loaded;
  if (envelope.status === "deleted") {
    return jsonError(410, "Envelope has been deleted", "deleted");
  }
  if (!signer.signedAt && !signer.declinedAt) {
    return jsonError(409, "Envelope is not completed", "not_completed");
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
  try {
    const brand = await loadBrand(db, envelope.userId, requireStore());
    const body = declineEmail({
      signerName: signer.name,
      title: envelope.title,
      reason,
      brand: {
        displayName: brand.displayName,
        hasLogo: Boolean(brand.logoBytes),
      },
    });
    await mailer.sendMail({
      to: envelope.senderEmail,
      ...body,
      attachments: brandMailAttachments(brand.logoBytes),
    });
  } catch (err) {
    await logEvent(db, {
      envelopeId: envelope.id,
      signerId: signer.id,
      event: "emailed_failed",
      payload: { error: err instanceof Error ? err.message : "mail_failed" },
    });
  }
  return Response.json({ status: "declined" });
}
