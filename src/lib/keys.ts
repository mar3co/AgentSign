import { and, eq, inArray, isNull } from "drizzle-orm";
import { getEnv } from "../env.js";
import { accounts, apiKeys, documents, signers as signersTable } from "../db/schema.js";
import type { AuditDb } from "./audit.js";
import { teamForUser } from "./team.js";
import { getDeps } from "./deps.js";
import { equalHex, sha256Hex } from "./hash.js";
import { newLiveKey } from "./tokens.js";

const MIN_KEEP_DAYS = 7;

export async function lookupApiKey(db: AuditDb, raw: string) {
  const hash = sha256Hex(raw);
  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.tokenHash, hash));
  if (!key || !equalHex(key.tokenHash, hash)) return null;
  return key;
}

export async function mintLiveKey(
  db: AuditDb,
  userId: string,
  opts: { expiresInDays?: number; now?: Date } = {},
): Promise<{ raw: string; prefix: string; expiresAt: Date }> {
  const live = newLiveKey();
  const at = opts.now ?? new Date();
  const days = opts.expiresInDays ?? 365;
  const expiresAt = new Date(at.getTime() + days * 86_400_000);
  await db.insert(apiKeys).values({
    kind: "live",
    prefix: live.prefix,
    tokenHash: live.hash,
    userId,
    expiresAt,
  });
  return { raw: live.raw, prefix: live.prefix, expiresAt };
}

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function ensureAccount(
  db: AuditDb,
  user: { id: string; email: string },
): Promise<void> {
  const email = normEmail(user.email);
  await db
    .insert(accounts)
    .values({ userId: user.id, email, plan: "free" })
    .onConflictDoUpdate({
      target: accounts.userId,
      set: { email },
    });
}

/** Attach unclaimed one-offs whose sender_email matches. Never steal another user_id. */
export async function claimSends(
  db: AuditDb,
  userId: string,
  email: string,
): Promise<void> {
  const claimed = await db
    .update(documents)
    .set({ userId })
    .where(and(eq(documents.senderEmail, normEmail(email)), isNull(documents.userId)))
    .returning();
  if (claimed.length === 0) return;
  const team = await teamForUser(db, userId);
  if (team.entitled) await extendKeep(db, userId);
}

/** Pro keep: completed documents this user sent or signed. Stripe webhook (Task 15). */
export async function extendKeep(db: AuditDb, userId: string): Promise<void> {
  const proDays = Number(getEnv().PRO_KEEP_DAYS);
  const at = getDeps().now?.() ?? new Date();
  const minKeep = new Date(at.getTime() + MIN_KEEP_DAYS * 86_400_000);

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId));
  const email = account?.email ?? null;

  const team = await teamForUser(db, userId);
  const senderIds =
    team.ownerUserId === userId ? team.memberUserIds : [userId];

  const sent = await db
    .select()
    .from(documents)
    .where(
      and(inArray(documents.userId, senderIds), eq(documents.status, "completed")),
    );

  const byId = new Map(sent.map((e) => [e.id, e]));
  if (email) {
    const signed = await db
      .select({ document: documents })
      .from(signersTable)
      .innerJoin(documents, eq(signersTable.documentId, documents.id))
      .where(
        and(eq(signersTable.email, email), eq(documents.status, "completed")),
      );
    for (const row of signed) byId.set(row.document.id, row.document);
  }

  for (const document of byId.values()) {
    const signerRows = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, document.id));
    let completedMs = 0;
    for (const s of signerRows) {
      const t = s.signedAt?.getTime() ?? 0;
      if (t > completedMs) completedMs = t;
    }
    const completedAt = completedMs > 0 ? new Date(completedMs) : at;
    const keep = new Date(completedAt.getTime() + proDays * 86_400_000);
    const shredAt = keep.getTime() > minKeep.getTime() ? keep : minKeep;
    await db.update(documents).set({ shredAt }).where(eq(documents.id, document.id));
    await syncTmpKeyExpiry(db, document.id, shredAt);
  }
}

/** Tmp keys die with shred_at, not the original signing window. */
export async function syncTmpKeyExpiry(
  db: AuditDb,
  documentId: string,
  shredAt: Date,
): Promise<void> {
  await db
    .update(apiKeys)
    .set({ expiresAt: shredAt })
    .where(and(eq(apiKeys.documentId, documentId), eq(apiKeys.kind, "tmp")));
}
