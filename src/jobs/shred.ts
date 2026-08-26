import { and, count, eq, lte, ne } from "drizzle-orm";
import {
  apiKeys,
  auditEvents,
  files,
  documents,
  signers as signersTable,
} from "../db/schema.js";
import { logEvent, type AuditDb } from "../lib/audit.js";
import { loadBrand } from "../lib/branding.js";
import { publicSignUrl } from "../lib/signing-url.js";
import { getDeps } from "../lib/deps.js";
import {
  brandMailAttachments,
  reminderEmail,
  type Mailer,
} from "../lib/email.js";
import {
  appearanceKey,
  fieldAppearanceKey,
  objectKey,
  type BlobStore,
} from "../lib/storage.js";
import {
  fireAgentPartyWebhooks,
  openWebhookSecret,
} from "../lib/webhooks.js";

const KINDS = ["original", "sealed", "certificate"] as const;
const REMIND_AFTER_MS = 3 * 86_400_000;
const MAX_REMINDERS = 2;

/** Hard-delete blobs, null document paths, tombstone, expire tmp keys, redact emails. */
export async function purgeDocument(
  db: AuditDb,
  store: BlobStore,
  documentId: string,
  now: Date,
  opts?: { force?: boolean },
): Promise<void> {
  const [claimed] = await db
    .update(documents)
    .set({ status: "deleted", senderEmail: "redacted" })
    .where(
      opts?.force
        ? and(eq(documents.id, documentId), ne(documents.status, "deleted"))
        : and(
            eq(documents.id, documentId),
            lte(documents.shredAt, now),
            ne(documents.status, "deleted"),
          ),
    )
    .returning();
  if (!claimed) return;

  for (const kind of KINDS) {
    await store.delete(objectKey(documentId, kind));
  }
  const signerRows = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.documentId, documentId));
  const fields = claimed.fields ?? [];
  for (const signer of signerRows) {
    await store.delete(appearanceKey(documentId, signer.id));
    for (const field of fields) {
      if (field.type !== "signature" && field.type !== "initials") continue;
      await store.delete(fieldAppearanceKey(documentId, signer.id, field.name));
    }
  }
  await db
    .update(files)
    .set({ storagePath: "" })
    .where(eq(files.documentId, documentId));
  await db
    .update(signersTable)
    .set({ email: "redacted" })
    .where(eq(signersTable.documentId, documentId));
  await db
    .update(apiKeys)
    .set({ expiresAt: now })
    .where(and(eq(apiKeys.documentId, documentId), eq(apiKeys.kind, "tmp")));
  await logEvent(db, { documentId, event: "deleted" });
}

/** Documents whose shred_at has passed; skip already deleted. */
export async function shredDue(
  db: AuditDb,
  store: BlobStore,
  now: Date,
): Promise<void> {
  const due = await db
    .select()
    .from(documents)
    .where(and(lte(documents.shredAt, now), ne(documents.status, "deleted")));
  for (const document of due) {
    if (document.status === "pending") {
      await fireAgentPartyWebhooks(db, document.id, {
        event: "document.expired",
        status: "expired",
      });
    }
    await purgeDocument(db, store, document.id, now);
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
    .from(documents)
    .where(eq(documents.status, "pending"));
  for (const document of pending) {
    if (document.expiresAt.getTime() <= now.getTime()) continue;
    if (document.sendEmail === false) continue;
    const rows = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, document.id));
    for (const signer of rows) {
      if (signer.kind === "agent") continue;
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
      const brand = await loadBrand(db, document.userId, getDeps().store);
      let signUrl: string | undefined;
      if (signer.tokenEnc) {
        try {
          signUrl = publicSignUrl(openWebhookSecret(signer.tokenEnc));
        } catch {
          // hash-only or corrupt token_enc: keep the unique-link sentence
        }
      }
      const reminder = reminderEmail({
        senderEmail: document.senderEmail,
        title: document.title,
        expiresAt: document.expiresAt,
        brand: {
          displayName: brand.displayName,
          hasLogo: Boolean(brand.logoBytes),
        },
        signUrl,
      });
      try {
        await mailer.sendMail({
          to: signer.email,
          ...reminder,
          attachments: brandMailAttachments(brand.logoBytes),
        });
      } catch (err) {
        await logEvent(db, {
          documentId: document.id,
          signerId: signer.id,
          event: "emailed_failed",
          payload: { error: err instanceof Error ? err.message : "mail_failed" },
        });
      }
      await logEvent(db, {
        documentId: document.id,
        signerId: signer.id,
        event: "reminded",
      });
    }
  }
}
