import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { auditEvents, envelopes, signers } from "../db/schema.js";
import type { AuditDb } from "../lib/audit.js";
import { getAuth } from "../lib/auth/supabase.js";
import { cabinetForUser } from "../lib/cabinet.js";
import { getDeps } from "../lib/deps.js";

/**
 * Audit events worth a person's attention. The rest (otp_sent, emailed,
 * webhook_*) is plumbing that stays in the per-envelope audit trail.
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
 * GET /v1/activity — recent notable events on the cabinet's envelopes.
 * Cookie session only: this feeds the portal header, not the public API.
 */
export async function listActivity(req: Request): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!cookie) return jsonError(401, "Unauthorized", "unauthorized");
  const user = await getAuth().userFromCookie(cookie);
  if (!user) return jsonError(401, "Unauthorized", "unauthorized");

  const db = requireDb();
  const cabinet = await cabinetForUser(db, user.id);
  const senderIds =
    cabinet.memberUserIds.length > 0 ? cabinet.memberUserIds : [user.id];

  const rows = await db
    .select({ event: auditEvents, envelope: envelopes, signer: signers })
    .from(auditEvents)
    .innerJoin(envelopes, eq(auditEvents.envelopeId, envelopes.id))
    .leftJoin(signers, eq(auditEvents.signerId, signers.id))
    .where(
      and(
        inArray(envelopes.userId, senderIds),
        ne(envelopes.status, "deleted"),
        inArray(auditEvents.event, [...SHOWN_EVENTS]),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(LIMIT);

  return Response.json({
    events: rows.map((r) => ({
      id: r.event.id,
      event: r.event.event,
      envelope_id: r.envelope.id,
      title: r.envelope.title,
      actor: r.signer?.name ?? null,
      actor_kind: r.signer?.kind ?? null,
      at: r.event.createdAt.toISOString(),
    })),
  });
}
