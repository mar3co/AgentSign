import { and, gte, inArray, ne } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { auditEvents, documents, signers } from "../db/schema.js";
import type { AuditDb } from "../lib/audit.js";
import { getAuth } from "../lib/auth/supabase.js";
import { teamForUser } from "../lib/team.js";
import { getDeps } from "../lib/deps.js";

const DAY_MS = 86_400_000;
const TREND_DAYS = 14;
const WEBHOOK_WINDOW_DAYS = 30;
const SHRED_SOON_DAYS = 7;

function requireDb(): AuditDb {
  return getDeps().db ?? getDb();
}

function now(): Date {
  return getDeps().now?.() ?? new Date();
}

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * GET /v1/stats — dashboard aggregates for the team's documents.
 * Cookie session only: this feeds the portal dashboard, not the public API.
 */
export async function getStats(req: Request): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!cookie) return jsonError(401, "Unauthorized", "unauthorized");
  const user = await getAuth().userFromCookie(cookie);
  if (!user) return jsonError(401, "Unauthorized", "unauthorized");

  const db = requireDb();
  const at = now();
  const team = await teamForUser(db, user.id);
  const senderIds =
    team.memberUserIds.length > 0 ? team.memberUserIds : [user.id];

  const docs = await db
    .select()
    .from(documents)
    .where(
      and(inArray(documents.userId, senderIds), ne(documents.status, "deleted")),
    );

  const docIds = docs.map((e) => e.id);
  const signerRows =
    docIds.length === 0
      ? []
      : await db
          .select()
          .from(signers)
          .where(inArray(signers.documentId, docIds));

  const agentDocIds = new Set(
    signerRows.filter((s) => s.kind === "agent").map((s) => s.documentId),
  );

  // An document completes with its last signature or sign-off.
  const completedAtById = new Map<string, Date>();
  for (const s of signerRows) {
    const t = s.signedAt ?? s.attestedAt;
    if (!t) continue;
    const prev = completedAtById.get(s.documentId);
    if (!prev || t > prev) completedAtById.set(s.documentId, t);
  }

  const thisMonth = startOfMonth(at);
  const lastMonth = startOfMonth(
    new Date(at.getFullYear(), at.getMonth() - 1, 1),
  );
  const inWindow = (d: Date | undefined, from: Date, to: Date) =>
    d !== undefined && d >= from && d < to;

  const completedDates = docs
    .filter((e) => e.status === "completed")
    .map((e) => completedAtById.get(e.id));

  // Trailing daily counts: sends split by whether an agent is on the
  // document, plus completions.
  const daily = new Map<
    string,
    { human: number; agent: number; completed: number }
  >();
  for (let i = TREND_DAYS - 1; i >= 0; i -= 1) {
    daily.set(dayKey(new Date(at.getTime() - i * DAY_MS)), {
      human: 0,
      agent: 0,
      completed: 0,
    });
  }
  for (const e of docs) {
    const bucket = daily.get(dayKey(e.createdAt));
    if (bucket) {
      if (agentDocIds.has(e.id)) bucket.agent += 1;
      else bucket.human += 1;
    }
    if (e.status === "completed") {
      const done = completedAtById.get(e.id);
      const doneBucket = done && daily.get(dayKey(done));
      if (doneBucket) doneBucket.completed += 1;
    }
  }

  const signingHours: number[] = [];
  for (const e of docs) {
    if (e.status !== "completed") continue;
    const done = completedAtById.get(e.id);
    if (!done) continue;
    const hours = (done.getTime() - e.createdAt.getTime()) / 3_600_000;
    if (hours >= 0) signingHours.push(hours);
  }

  const byStatus: Record<string, number> = {};
  for (const e of docs) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;

  const shredSoonCutoff = new Date(at.getTime() + SHRED_SOON_DAYS * DAY_MS);
  const shreddingSoon = docs.filter((e) => e.shredAt <= shredSoonCutoff).length;

  const webhookSince = new Date(at.getTime() - WEBHOOK_WINDOW_DAYS * DAY_MS);
  const webhookRows =
    docIds.length === 0
      ? []
      : await db
          .select({ event: auditEvents.event })
          .from(auditEvents)
          .where(
            and(
              inArray(auditEvents.documentId, docIds),
              inArray(auditEvents.event, ["webhook_sent", "webhook_failed"]),
              gte(auditEvents.createdAt, webhookSince),
            ),
          );

  return Response.json({
    total: docs.length,
    by_status: byStatus,
    sent: {
      this_month: docs.filter((e) => inWindow(e.createdAt, thisMonth, at)).length,
      last_month: docs.filter((e) => inWindow(e.createdAt, lastMonth, thisMonth))
        .length,
      agent_share: docs.length === 0 ? 0 : agentDocIds.size / docs.length,
    },
    completed: {
      this_month: completedDates.filter((d) => inWindow(d, thisMonth, at)).length,
      last_month: completedDates.filter((d) => inWindow(d, lastMonth, thisMonth))
        .length,
    },
    daily: [...daily.entries()].map(([date, counts]) => ({ date, ...counts })),
    median_signing_hours: median(signingHours),
    shredding_soon: shreddingSoon,
    webhooks_30d: {
      sent: webhookRows.filter((r) => r.event === "webhook_sent").length,
      failed: webhookRows.filter((r) => r.event === "webhook_failed").length,
    },
  });
}
