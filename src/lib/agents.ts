import { and, count, eq, isNull } from "drizzle-orm";
import { agents } from "../db/schema.js";
import type { AuditDb } from "./audit.js";

const SLUG_RE = /^[a-z0-9-]{1,40}$/;

export type AgentRow = typeof agents.$inferSelect;

/** `[a-z0-9-]{1,40}` with no leading or trailing hyphen. */
export function parseAgentSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw.trim();
  if (!SLUG_RE.test(slug)) return null;
  if (slug.startsWith("-") || slug.endsWith("-")) return null;
  return slug;
}

export async function activeAgentCount(
  db: AuditDb,
  ownerUserId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(agents)
    .where(and(eq(agents.ownerUserId, ownerUserId), isNull(agents.revokedAt)));
  return Number(row?.n ?? 0);
}

export async function loadAgent(
  db: AuditDb,
  ownerUserId: string,
  id: string,
): Promise<AgentRow | null> {
  if (!id) return null;
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.ownerUserId, ownerUserId)));
  return row ?? null;
}

/** Active (unrevoked) named agent for a cabinet owner + slug. */
export async function loadActiveAgentBySlug(
  db: AuditDb,
  ownerUserId: string,
  slug: string,
): Promise<AgentRow | null> {
  if (!slug) return null;
  const [row] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.ownerUserId, ownerUserId),
        eq(agents.slug, slug),
        isNull(agents.revokedAt),
      ),
    );
  return row ?? null;
}
