import { eq, inArray } from "drizzle-orm";
import {
  accounts,
  agents,
  documents,
  teamMembers,
  templates,
} from "../db/schema.js";
import { teamForUser } from "../lib/team.js";
import { requireCaller } from "../lib/caller.js";
import { getDeps } from "../lib/deps.js";

const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function requireOwner(
  callerId: string,
  ownerUserId: string,
): { ok: true } | { ok: false; response: Response } {
  if (callerId !== ownerUserId) {
    return { ok: false, response: jsonError(403, "Forbidden", "forbidden") };
  }
  return { ok: true };
}

async function requireWorkspace(req: Request) {
  const caller = await requireCaller(req, { allowOauth: false });
  if (!caller.ok) return caller;
  const team = await teamForUser(caller.db, caller.user.id);
  return { ok: true as const, caller, team };
}

function workspaceJson(
  team: Awaited<ReturnType<typeof teamForUser>>,
  callerId: string,
) {
  return {
    app_id: team.ownerUserId,
    display_name: team.displayName,
    timezone: team.timezone,
    description: team.description,
    role: callerId === team.ownerUserId ? ("owner" as const) : ("member" as const),
    can_edit: callerId === team.ownerUserId,
  };
}

function parseDisplayName(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; response: Response } {
  if (typeof raw !== "string") {
    return {
      ok: false,
      response: jsonError(400, "display_name must be a string", "invalid_request"),
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > NAME_MAX) {
    return {
      ok: false,
      response: jsonError(
        400,
        "display_name must be 80 characters or fewer",
        "invalid_request",
      ),
    };
  }
  return { ok: true, value: trimmed };
}

function parseTimeZone(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; response: Response } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return {
      ok: false,
      response: jsonError(400, "timezone must be a string", "invalid_request"),
    };
  }
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    return {
      ok: false,
      response: jsonError(400, "Unknown timezone", "invalid_request"),
    };
  }
  return { ok: true, value };
}

function parseDescription(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; response: Response } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return {
      ok: false,
      response: jsonError(400, "description must be a string", "invalid_request"),
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > DESCRIPTION_MAX) {
    return {
      ok: false,
      response: jsonError(
        400,
        "description must be 500 characters or fewer",
        "invalid_request",
      ),
    };
  }
  return { ok: true, value: trimmed };
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function getWorkspace(req: Request): Promise<Response> {
  const gate = await requireWorkspace(req);
  if (!gate.ok) return gate.response;
  return Response.json(workspaceJson(gate.team, gate.caller.user.id));
}

export async function patchWorkspace(req: Request): Promise<Response> {
  const gate = await requireWorkspace(req);
  if (!gate.ok) return gate.response;
  const owner = requireOwner(gate.caller.user.id, gate.team.ownerUserId);
  if (!owner.ok) return owner.response;

  const body = await readJson(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  const rec = body as Record<string, unknown>;
  const patch: {
    displayName?: string | null;
    timezone?: string | null;
    description?: string | null;
  } = {};
  if ("display_name" in rec) {
    const parsed = parseDisplayName(rec.display_name);
    if (!parsed.ok) return parsed.response;
    patch.displayName = parsed.value;
  }
  if ("timezone" in rec) {
    const parsed = parseTimeZone(rec.timezone);
    if (!parsed.ok) return parsed.response;
    patch.timezone = parsed.value;
  }
  if ("description" in rec) {
    const parsed = parseDescription(rec.description);
    if (!parsed.ok) return parsed.response;
    patch.description = parsed.value;
  }
  if (Object.keys(patch).length > 0) {
    await gate.caller.db
      .update(accounts)
      .set(patch)
      .where(eq(accounts.userId, gate.team.ownerUserId));
  }
  const updated = await teamForUser(gate.caller.db, gate.caller.user.id);
  return Response.json(workspaceJson(updated, gate.caller.user.id));
}

export async function exportWorkspace(req: Request): Promise<Response> {
  const gate = await requireWorkspace(req);
  if (!gate.ok) return gate.response;
  const { db } = gate.caller;
  const ownerUserId = gate.team.ownerUserId;
  const at = getDeps().now?.() ?? new Date();
  const senderIds = gate.team.memberUserIds;

  const ownedDocs =
    senderIds.length === 0
      ? []
      : await db
          .select({
            id: documents.id,
            title: documents.title,
            status: documents.status,
            sender_email: documents.senderEmail,
            created_at: documents.createdAt,
            expires_at: documents.expiresAt,
            shred_at: documents.shredAt,
          })
          .from(documents)
          .where(
            inArray(documents.userId, senderIds),
          );

  const exportedDocs = ownedDocs
    .filter((d) => d.status !== "deleted")
    .map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      sender_email: row.sender_email,
      created_at: row.created_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      shred_at: row.shred_at.toISOString(),
    }));

  const templateRows = await db
    .select({
      id: templates.id,
      title: templates.title,
      created_at: templates.createdAt,
    })
    .from(templates)
    .where(eq(templates.ownerUserId, ownerUserId));

  const agentRows = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      created_at: agents.createdAt,
      revoked_at: agents.revokedAt,
    })
    .from(agents)
    .where(eq(agents.ownerUserId, ownerUserId));

  const payload = {
    exported_at: at.toISOString(),
    workspace: {
      app_id: ownerUserId,
      display_name: gate.team.displayName,
      timezone: gate.team.timezone,
      description: gate.team.description,
    },
    members: [
      {
        email: gate.team.ownerEmail,
        role: "owner" as const,
        status: "active" as const,
      },
      ...gate.team.members.map((m) => ({
        email: m.email,
        role: "member" as const,
        status: m.status,
      })),
    ],
    documents: exportedDocs,
    templates: templateRows.map((t) => ({
      id: t.id,
      title: t.title,
      created_at: t.created_at.toISOString(),
    })),
    agents: agentRows.map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      created_at: a.created_at.toISOString(),
      revoked_at: a.revoked_at ? a.revoked_at.toISOString() : null,
    })),
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="workspace.json"',
    },
  });
}

export async function dissolveWorkspace(req: Request): Promise<Response> {
  const gate = await requireWorkspace(req);
  if (!gate.ok) return gate.response;
  const owner = requireOwner(gate.caller.user.id, gate.team.ownerUserId);
  if (!owner.ok) return owner.response;

  await gate.caller.db
    .delete(teamMembers)
    .where(eq(teamMembers.ownerUserId, gate.team.ownerUserId));
  return new Response(null, { status: 204 });
}
