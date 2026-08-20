import { and, count, eq, lte, ne } from "drizzle-orm";
import {
  apiKeys,
  auditEvents,
  documents,
  envelopes,
  signers as signersTable,
} from "../db/schema.js";
import { logEvent, type AuditDb } from "../lib/audit.js";
import { reminderEmail, type Mailer } from "../lib/email.js";
import { appearanceKey, objectKey, type BlobStore } from "../lib/storage.js";

const KINDS = ["original", "sealed", "certificate"] as const;
const REMIND_AFTER_MS = 3 * 86_400_000;
const MAX_REMINDERS = 2;

/** Hard-delete blobs, null document paths, tombstone, expire tmp keys, redact emails. */
export async function purgeEnvelope(
  db: AuditDb,
  store: BlobStore,
  envelopeId: string,
  now: Date,
  opts?: { force?: boolean },
): Promise<void> {
  const [claimed] = await db
    .update(envelopes)
    .set({ status: "deleted", senderEmail: "redacted" })
    .where(
      opts?.force
        ? and(eq(envelopes.id, envelopeId), ne(envelopes.status, "deleted"))
        : and(
            eq(envelopes.id, envelopeId),
            lte(envelopes.shredAt, now),
            ne(envelopes.status, "deleted"),
          ),
    )
    .returning();
  if (!claimed) return;

  for (const kind of KINDS) {
    await store.delete(objectKey(envelopeId, kind));
  }
  const signerRows = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.envelopeId, envelopeId));
  for (const signer of signerRows) {
    await store.delete(appearanceKey(envelopeId, signer.id));
  }
  await db
    .update(documents)
    .set({ storagePath: "" })
    .where(eq(documents.envelopeId, envelopeId));
  await db
    .update(signersTable)
    .set({ email: "redacted" })
    .where(eq(signersTable.envelopeId, envelopeId));
  await db
    .update(apiKeys)
    .set({ expiresAt: now })
    .where(and(eq(apiKeys.envelopeId, envelopeId), eq(apiKeys.kind, "tmp")));
  await logEvent(db, { envelopeId, event: "deleted" });
}

/** Envelopes whose shred_at has passed; skip already deleted. */
export async function shredDue(
  db: AuditDb,
  store: BlobStore,
  now: Date,
): Promise<void> {
  const due = await db
    .select()
    .from(envelopes)
    .where(and(lte(envelopes.shredAt, now), ne(envelopes.status, "deleted")));
  for (const envelope of due) {
    await purgeEnvelope(db, store, envelope.id, now);
  }
}

/** Nudge pending signers at most twice, 3 days apart, before expires_at. Does not remint tokens. */
export async function remindDue(
  db: AuditDb,
  mailer: Mailer,
  now: Date,
): Promise<void> {
  const pending = await db
    .select()
    .from(envelopes)
    .where(eq(envelopes.status, "pending"));
  for (const envelope of pending) {
    if (envelope.expiresAt.getTime() <= now.getTime()) continue;
    const rows = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.envelopeId, envelope.id));
    for (const signer of rows) {
      if (signer.signedAt || signer.declinedAt || !signer.sentAt) continue;
      if (now.getTime() - signer.sentAt.getTime() < REMIND_AFTER_MS) continue;
      if (
        signer.remindedAt &&
        now.getTime() - signer.remindedAt.getTime() < REMIND_AFTER_MS
      ) {
        continue;
      }
      const [n] = await db
        .select({ n: count() })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.signerId, signer.id),
            eq(auditEvents.event, "reminded"),
          ),
        );
      if (Number(n?.n ?? 0) >= MAX_REMINDERS) continue;

      await db
        .update(signersTable)
        .set({ remindedAt: now })
        .where(eq(signersTable.id, signer.id));
      const reminder = reminderEmail({
        senderEmail: envelope.senderEmail,
        title: envelope.title,
        expiresAt: envelope.expiresAt,
      });
      try {
        await mailer.sendMail({ to: signer.email, ...reminder });
      } catch (err) {
        await logEvent(db, {
          envelopeId: envelope.id,
          signerId: signer.id,
          event: "emailed_failed",
          payload: { error: err instanceof Error ? err.message : "mail_failed" },
        });
      }
      await logEvent(db, {
        envelopeId: envelope.id,
        signerId: signer.id,
        event: "reminded",
      });
    }
  }
}
