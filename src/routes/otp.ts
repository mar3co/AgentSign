import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import {
  apiKeys,
  envelopes,
  otpChallenges,
  signers as signersTable,
} from "../db/schema.js";
import { logEvent } from "../lib/audit.js";
import { getDeps } from "../lib/deps.js";
import {
  createMailer,
  inviteEmail,
  sendLiveEmail,
  type Mailer,
} from "../lib/email.js";
import { verifyOtp } from "../lib/otp.js";
import { newSigningToken, newTmpKey } from "../lib/tokens.js";

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

export async function verifyEnvelopeOtp(
  req: Request,
  envelopeId: string,
): Promise<Response> {
  if (!envelopeId) {
    return jsonError(400, "Envelope id is required", "invalid_request");
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, "OTP code is required", "invalid_request");
  }

  const db = requireDb();
  const at = now();

  const [envelope] = await db
    .select()
    .from(envelopes)
    .where(eq(envelopes.id, envelopeId));
  if (!envelope) return jsonError(404, "Envelope not found", "not_found");
  if (envelope.status !== "pending_sender") {
    return jsonError(
      409,
      "Envelope is not awaiting sender verification",
      "invalid_state",
    );
  }

  const [challenge] = await db
    .select()
    .from(otpChallenges)
    .where(eq(otpChallenges.envelopeId, envelopeId));
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

  await db
    .update(otpChallenges)
    .set({ consumedAt: at })
    .where(eq(otpChallenges.id, challenge.id));
  await db
    .update(envelopes)
    .set({ status: "pending" })
    .where(eq(envelopes.id, envelope.id));

  const signerRows = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.envelopeId, envelope.id));
  signerRows.sort((a, b) => a.signingOrder - b.signingOrder);

  // Mint a real signing token only for signer 1; later signers keep pending placeholders.
  const outSigners: { email: string; sign_url: string | null }[] = [];
  let firstSignUrl: string | null = null;
  for (const row of signerRows) {
    if (row.signingOrder === 1) {
      const token = newSigningToken();
      const signUrl = `/s/${token.raw}`;
      await db
        .update(signersTable)
        .set({ tokenHash: token.hash })
        .where(eq(signersTable.id, row.id));
      firstSignUrl = signUrl;
      outSigners.push({ email: row.email, sign_url: signUrl });
    } else {
      outSigners.push({ email: row.email, sign_url: null });
    }
  }

  const tmp = newTmpKey();
  await db.insert(apiKeys).values({
    kind: "tmp",
    prefix: tmp.prefix,
    tokenHash: tmp.hash,
    envelopeId: envelope.id,
    expiresAt: envelope.shredAt,
  });
  await logEvent(db, { envelopeId: envelope.id, event: "email_verified" });

  const mailer = requireMailer();
  const first = signerRows[0];
  if (first && firstSignUrl) {
    const invite = inviteEmail({
      signUrl: firstSignUrl,
      senderEmail: envelope.senderEmail,
      title: envelope.title,
      expiresAt: envelope.expiresAt,
    });
    try {
      await mailer.sendMail({ to: first.email, ...invite });
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
  }

  try {
    const live = sendLiveEmail({
      title: envelope.title,
      tmpKeyShownInResponse: true,
    });
    await mailer.sendMail({ to: envelope.senderEmail, ...live });
  } catch (err) {
    await logEvent(db, {
      envelopeId: envelope.id,
      event: "emailed_failed",
      payload: { error: err instanceof Error ? err.message : "mail_failed" },
    });
  }

  return Response.json({
    id: envelope.id,
    status: "pending",
    key: tmp.raw,
    signers: outSigners,
  });
}
