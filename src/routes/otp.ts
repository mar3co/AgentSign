import { and, count, eq, gte, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import {
  accounts,
  apiKeys,
  documents,
  otpChallenges,
} from "../db/schema.js";
import { getEnv } from "../env.js";
import { logEvent } from "../lib/audit.js";
import { loadBrand } from "../lib/branding.js";
import { getDeps } from "../lib/deps.js";
import {
  brandMailAttachments,
  createMailer,
  sendLiveEmail,
  type Mailer,
} from "../lib/email.js";
import { verifyOtp } from "../lib/otp.js";
import { newTmpKey } from "../lib/tokens.js";
import { webhookEncryptionReady } from "../lib/webhooks.js";
import { inviteFirstSigner } from "./documents.js";

const MAX_ATTEMPTS = 5;

const bodySchema = z.object({
  code: z.string(),
});

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function requireDb() {
  return getDeps().db ?? getDb();
}

function requireMailer(): Mailer {
  return getDeps().mailer ?? createMailer();
}

function now(): Date {
  return getDeps().now?.() ?? new Date();
}

export async function verifyDocumentOtp(
  req: Request,
  documentId: string,
): Promise<Response> {
  if (!documentId) {
    return jsonError(400, "Document id is required", "invalid_request");
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, "OTP code is required", "invalid_request");
  }

  const db = requireDb();
  const at = now();

  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId));
  if (!document) return jsonError(404, "Document not found", "not_found");
  if (document.status !== "pending_sender") {
    return jsonError(
      409,
      "Document is not awaiting sender verification",
      "invalid_state",
    );
  }

  const [challenge] = await db
    .select()
    .from(otpChallenges)
    .where(eq(otpChallenges.documentId, documentId));
  if (!challenge) return jsonError(404, "OTP challenge not found", "not_found");
  if (challenge.consumedAt) {
    return jsonError(410, "OTP is no longer valid", "otp_expired");
  }
  if (challenge.expiresAt.getTime() <= at.getTime()) {
    return jsonError(410, "OTP is no longer valid", "otp_expired");
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    return jsonError(403, "Too many attempts", "otp_locked");
  }

  const ok = await verifyOtp(parsed.code, challenge.codeHash);
  if (!ok) {
    const attempts = challenge.attempts + 1;
    await db
      .update(otpChallenges)
      .set({ attempts })
      .where(eq(otpChallenges.id, challenge.id));
    if (attempts >= MAX_ATTEMPTS) {
      return jsonError(403, "Too many attempts", "otp_locked");
    }
    return jsonError(400, "Invalid code", "invalid_otp");
  }

  const env = getEnv();
  const limit = Number(env.FREE_SEND_LIMIT);
  const windowDays = Number(env.FREE_SEND_WINDOW_DAYS);
  const windowStart = new Date(at.getTime() - windowDays * 86_400_000);
  const [cap] = await db
    .select({ n: count() })
    .from(documents)
    .where(
      and(
        eq(documents.senderEmail, document.senderEmail),
        gte(documents.createdAt, windowStart),
        ne(documents.status, "pending_sender"),
      ),
    );
  if (Number(cap?.n ?? 0) >= limit) {
    return jsonError(429, "Send limit reached. Try again later.", "send_limit");
  }

  if (!webhookEncryptionReady()) {
    return jsonError(
      503,
      "Webhook encryption is not configured",
      "webhook_unconfigured",
    );
  }

  const [owner] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.email, document.senderEmail));

  await db
    .update(otpChallenges)
    .set({ consumedAt: at })
    .where(eq(otpChallenges.id, challenge.id));
  await db
    .update(documents)
    .set({
      status: "pending",
      ...(owner ? { userId: owner.userId } : {}),
    })
    .where(eq(documents.id, document.id));

  const invited = await inviteFirstSigner(
    db,
    requireMailer(),
    {
      id: document.id,
      senderEmail: document.senderEmail,
      title: document.title,
      expiresAt: document.expiresAt,
      userId: owner?.userId ?? document.userId,
      sendEmail: document.sendEmail,
      signingMode:
        document.signingMode === "parallel" ? "parallel" : "sequential",
      message: document.message,
    },
    at,
  );

  const tmp = newTmpKey();
  await db.insert(apiKeys).values({
    kind: "tmp",
    prefix: tmp.prefix,
    tokenHash: tmp.hash,
    documentId: document.id,
    expiresAt: document.shredAt,
  });
  await logEvent(db, { documentId: document.id, event: "email_verified" });

  const mailer = requireMailer();
  const brand = await loadBrand(
    db,
    owner?.userId ?? document.userId,
    getDeps().store,
  );
  const mailBrand = {
    displayName: brand.displayName,
    hasLogo: Boolean(brand.logoBytes),
  };

  try {
    const live = sendLiveEmail({
      title: document.title,
      tmpKeyShownInResponse: true,
      senderEmail: document.senderEmail,
      brand: mailBrand,
    });
    await mailer.sendMail({
      to: document.senderEmail,
      ...live,
      attachments: brandMailAttachments(brand.logoBytes),
    });
  } catch (err) {
    await logEvent(db, {
      documentId: document.id,
      event: "emailed_failed",
      payload: { error: err instanceof Error ? err.message : "mail_failed" },
    });
  }

  return Response.json({
    id: document.id,
    status: "pending",
    key: tmp.raw,
    signers: invited.signers,
  });
}
