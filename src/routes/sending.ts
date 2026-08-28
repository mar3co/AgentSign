import { eq } from "drizzle-orm";
import { accounts } from "../db/schema.js";
import type { AuditDb } from "../lib/audit.js";
import { requireCaller, type CallerOk } from "../lib/caller.js";

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

/** Only a signed-in person may read or change send confirmation — an agent
 *  or API key must never be able to switch off its own approval gate. */
async function requireSession(
  req: Request,
): Promise<{ ok: true; caller: CallerOk } | { ok: false; response: Response }> {
  const caller = await requireCaller(req, { allowOauth: false });
  if (!caller.ok) return caller;
  if (caller.via !== "session") {
    return {
      ok: false,
      response: jsonError(403, "Sign in to manage sending", "forbidden"),
    };
  }
  return { ok: true, caller };
}

async function sendingJson(db: AuditDb, userId: string): Promise<Response> {
  const [acct] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId));
  return Response.json({
    confirm_agent_sends: acct?.confirmAgentSends ?? true,
    confirm_human_sends: acct?.confirmHumanSends ?? false,
  });
}

export async function getSending(req: Request): Promise<Response> {
  const gate = await requireSession(req);
  if (!gate.ok) return gate.response;
  return sendingJson(gate.caller.db, gate.caller.user.id);
}

export async function patchSending(req: Request): Promise<Response> {
  const gate = await requireSession(req);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  const patch: Partial<{
    confirmAgentSends: boolean;
    confirmHumanSends: boolean;
  }> = {};
  const agent = (body as { confirm_agent_sends?: unknown }).confirm_agent_sends;
  const human = (body as { confirm_human_sends?: unknown }).confirm_human_sends;
  if (agent !== undefined) {
    if (typeof agent !== "boolean") {
      return jsonError(400, "confirm_agent_sends must be a boolean", "invalid_request");
    }
    patch.confirmAgentSends = agent;
  }
  if (human !== undefined) {
    if (typeof human !== "boolean") {
      return jsonError(400, "confirm_human_sends must be a boolean", "invalid_request");
    }
    patch.confirmHumanSends = human;
  }

  if (Object.keys(patch).length > 0) {
    await gate.caller.db
      .update(accounts)
      .set(patch)
      .where(eq(accounts.userId, gate.caller.user.id));
  }
  return sendingJson(gate.caller.db, gate.caller.user.id);
}
