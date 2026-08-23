import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { auditEvents, documents, signers } from "../db/schema.js";
import type { AuditDb } from "../lib/audit.js";
import { getAuth } from "../lib/auth/supabase.js";
import { teamForUser } from "../lib/team.js";
import { getDeps } from "../lib/deps.js";

/**
 * Audit events worth a person's attention. The rest (otp_sent, emailed,
 * webhook_*) is plumbing that stays in the per-document audit trail.
 */
const SHOWN_EVENTS = [
  "sent",
  "opened",
  "consented",
  "signed",
  "attested",
  "declined",
  "rejected",
  "reminded",
  "expired",
] as const;

export type ActivityEventName = (typeof SHOWN_EVENTS)[number];

const LIMIT = 30;

function requireDb(): AuditDb {
  return getDeps().db ?? getDb();
}

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

/**
 * GET /v1/activity — recent notable events on the team's documents.
 * Cookie session only: this feeds the portal header, not the public API.
 */
export async function listActivity(req: Request): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!cookie) return jsonError(401, "Unauthorized", "unauthorized");
  const user = await getAuth().userFromCookie(cookie);
  if (!user) return jsonError(401, "Unauthorized", "unauthorized");

  const db = requireDb();
  const team = await teamForUser(db, user.id);
  const senderIds =
    team.memberUserIds.length > 0 ? team.memberUserIds : [user.id];

  const rows = await db
    .select({ event: auditEvents, document: documents, signer: signers })
    .from(auditEvents)
    .innerJoin(documents, eq(auditEvents.documentId, documents.id))
    .leftJoin(signers, eq(auditEvents.signerId, signers.id))
    .where(
      and(
        inArray(documents.userId, senderIds),
        ne(documents.status, "deleted"),
        inArray(auditEvents.event, [...SHOWN_EVENTS]),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(LIMIT);

  return Response.json({
    events: rows.map((r) => ({
      id: r.event.id,
      event: r.event.event,
      document_id: r.document.id,
      title: r.document.title,
      actor: r.signer?.name ?? null,
      actor_kind: r.signer?.kind ?? null,
      at: r.event.createdAt.toISOString(),
    })),
  });
}
