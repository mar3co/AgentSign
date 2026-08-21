import { and, eq } from "drizzle-orm";
import { agents, apiKeys } from "../db/schema.js";
import {
  activeAgentCount,
  loadAgent,
  parseAgentSlug,
  type AgentRow,
} from "../lib/agents.js";
import type { AuditDb } from "../lib/audit.js";
import { cabinetForUser } from "../lib/cabinet.js";
import { requireCaller } from "../lib/caller.js";
import { getDeps } from "../lib/deps.js";
import { AGENT_CAP } from "../lib/entitlement.js";
import { flagOn } from "../lib/flags.js";
import { newAgentKey } from "../lib/tokens.js";
import {
  newWebhookSecret,
  sealWebhookSecret,
  webhookUrlError,
} from "../lib/webhooks.js";

const KEY_DAYS = 365;
const NAME_MAX = 80;

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function now(): Date {
  return getDeps().now?.() ?? new Date();
}

function agentJson(row: AgentRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    has_webhook: Boolean(row.webhookUrl),
    created_at: row.createdAt.toISOString(),
    revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

function parseName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > NAME_MAX) return null;
  return name;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

async function requireAgentApi(req: Request, write: boolean) {
  const caller = await requireCaller(req, { allowOauth: false });
  if (!caller.ok) return caller;
  if (!(await flagOn("agent_parties"))) {
    return {
      ok: false as const,
      response: jsonError(403, "Agent parties are disabled", "flag_off"),
    };
  }
  const cabinet = await cabinetForUser(caller.db, caller.user.id);
  if (!cabinet.entitled) {
    return {
      ok: false as const,
      response: jsonError(403, "Pro plan required", "pro_required"),
    };
  }
  if (write && caller.user.id !== cabinet.ownerUserId) {
    return {
      ok: false as const,
      response: jsonError(403, "Only the owner can manage agents", "not_owner"),
    };
  }
  return { ok: true as const, caller, cabinet };
}

async function requireActiveAgent(
  db: AuditDb,
  ownerUserId: string,
  id: string,
): Promise<{ ok: true; agent: AgentRow } | { ok: false; response: Response }> {
  const agent = await loadAgent(db, ownerUserId, id);
  if (!agent || agent.revokedAt) {
    return { ok: false, response: jsonError(404, "Agent not found", "not_found") };
  }
  return { ok: true, agent };
}

async function expireAgentKeys(db: AuditDb, agentId: string, at: Date) {
  await db
    .update(apiKeys)
    .set({ expiresAt: at })
    .where(and(eq(apiKeys.agentId, agentId), eq(apiKeys.kind, "agent")));
}

async function mintAgentKey(
  db: AuditDb,
  ownerUserId: string,
  agentId: string,
  at: Date,
) {
  const minted = newAgentKey();
  await db.insert(apiKeys).values({
    kind: "agent",
    prefix: minted.prefix,
    tokenHash: minted.hash,
    userId: ownerUserId,
    agentId,
    expiresAt: new Date(at.getTime() + KEY_DAYS * 86_400_000),
  });
  return minted;
}

async function resolveWebhookUrl(
  raw: unknown,
): Promise<
  | { ok: true; url: string | null; secret: string | null; sealed: string | null }
  | { ok: false; response: Response }
> {
  if (raw == null || raw === "") {
    return { ok: true, url: null, secret: null, sealed: null };
  }
  if (typeof raw !== "string") {
    return {
      ok: false,
      response: jsonError(400, "webhook_url must be a string", "invalid_request"),
    };
  }
  const url = raw.trim();
  if (!url) return { ok: true, url: null, secret: null, sealed: null };
  const blocked = await webhookUrlError(url);
  if (blocked) return { ok: false, response: jsonError(400, blocked, "invalid_webhook_url") };
  const secret = newWebhookSecret();
  return { ok: true, url, secret, sealed: sealWebhookSecret(secret) };
}

export async function listAgents(req: Request): Promise<Response> {
  const gate = await requireAgentApi(req, false);
  if (!gate.ok) return gate.response;
  const rows = await gate.caller.db
    .select()
    .from(agents)
    .where(eq(agents.ownerUserId, gate.cabinet.ownerUserId));
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return Response.json({
    agents: rows.map(agentJson),
    can_edit: gate.caller.user.id === gate.cabinet.ownerUserId,
  });
}

export async function createAgent(req: Request): Promise<Response> {
  const gate = await requireAgentApi(req, true);
  if (!gate.ok) return gate.response;

  const body = await readJson(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  const json = body as { slug?: unknown; name?: unknown; webhook_url?: unknown };
  const slug = parseAgentSlug(json.slug);
  if (!slug) return jsonError(400, "Invalid slug", "invalid_slug");
  const name = parseName(json.name);
  if (!name) return jsonError(400, "Name is required", "invalid_request");

  const webhook = await resolveWebhookUrl(json.webhook_url);
  if (!webhook.ok) return webhook.response;

  const { db } = gate.caller;
  const ownerUserId = gate.cabinet.ownerUserId;
  const [taken] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.ownerUserId, ownerUserId), eq(agents.slug, slug)));
  if (taken) return jsonError(409, "Slug already taken", "slug_taken");

  if ((await activeAgentCount(db, ownerUserId)) >= AGENT_CAP) {
    return jsonError(400, "Agent limit reached", "agent_limit");
  }

  const at = now();
  const [row] = await db
    .insert(agents)
    .values({
      ownerUserId,
      slug,
      name,
      webhookUrl: webhook.url,
      webhookSecretHash: webhook.sealed,
    })
    .returning();
  const minted = await mintAgentKey(db, ownerUserId, row.id, at);
  return Response.json(
    {
      ...agentJson(row),
      key: minted.raw,
      prefix: minted.prefix,
      ...(webhook.secret ? { webhook_secret: webhook.secret } : {}),
    },
    { status: 201 },
  );
}

export async function rotateAgent(req: Request, id: string): Promise<Response> {
  const gate = await requireAgentApi(req, true);
  if (!gate.ok) return gate.response;
  const loaded = await requireActiveAgent(gate.caller.db, gate.cabinet.ownerUserId, id);
  if (!loaded.ok) return loaded.response;

  const at = now();
  await expireAgentKeys(gate.caller.db, loaded.agent.id, at);
  const minted = await mintAgentKey(
    gate.caller.db,
    gate.cabinet.ownerUserId,
    loaded.agent.id,
    at,
  );
  return Response.json({
    ...agentJson(loaded.agent),
    key: minted.raw,
    prefix: minted.prefix,
  });
}

export async function putAgentWebhook(req: Request, id: string): Promise<Response> {
  const gate = await requireAgentApi(req, true);
  if (!gate.ok) return gate.response;
  const loaded = await requireActiveAgent(gate.caller.db, gate.cabinet.ownerUserId, id);
  if (!loaded.ok) return loaded.response;

  const body = await readJson(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  if (!("webhook_url" in body)) {
    return jsonError(400, "webhook_url is required", "invalid_request");
  }
  const webhook = await resolveWebhookUrl((body as { webhook_url?: unknown }).webhook_url);
  if (!webhook.ok) return webhook.response;
  const clear = (body as { clear?: unknown }).clear === true;
  if (webhook.url == null && !clear) {
    return jsonError(
      400,
      loaded.agent.webhookUrl
        ? "Pass clear: true to remove the webhook"
        : "webhook_url is required",
      "invalid_request",
    );
  }

  await gate.caller.db
    .update(agents)
    .set({
      webhookUrl: webhook.url,
      webhookSecretHash: webhook.sealed,
    })
    .where(eq(agents.id, loaded.agent.id));

  if (webhook.secret) return Response.json({ webhook_secret: webhook.secret });
  return Response.json({});
}

export async function revokeAgent(req: Request, id: string): Promise<Response> {
  const gate = await requireAgentApi(req, true);
  if (!gate.ok) return gate.response;
  const loaded = await requireActiveAgent(gate.caller.db, gate.cabinet.ownerUserId, id);
  if (!loaded.ok) return loaded.response;

  const at = now();
  await gate.caller.db
    .update(agents)
    .set({ revokedAt: at })
    .where(eq(agents.id, loaded.agent.id));
  await expireAgentKeys(gate.caller.db, loaded.agent.id, at);
  return new Response(null, { status: 204 });
}
