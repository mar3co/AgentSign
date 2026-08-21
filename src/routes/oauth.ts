import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";
import { agents, oauthClients } from "../db/schema.js";
import { appOrigin } from "../env.js";
import { getAuth } from "../lib/auth/supabase.js";
import type { AuditDb } from "../lib/audit.js";
import { cabinetForUser } from "../lib/cabinet.js";
import { getDeps } from "../lib/deps.js";
import { ensureAccount } from "../lib/keys.js";
import {
  consumeAuthorizationCode,
  insertAuthorizationCode,
  issueGrantTokens,
  lookupOauthGrantByRefresh,
  mcpResource,
  pkceMatches,
  resolveOauthClient,
  rotateGrantTokens,
  type OauthClientRow,
} from "../lib/oauth.js";
import { safeNext } from "../lib/safeNext.js";

function jsonError(status: number, error: string, description?: string): Response {
  return Response.json(
    {
      error,
      error_description: description ?? error,
      code: error,
    },
    { status },
  );
}

function requireDb(): AuditDb {
  return getDeps().db ?? getDb();
}

export function protectedResourceMetadata() {
  const origin = appOrigin();
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["send", "status", "download"],
  };
}

export function authorizationServerMetadata() {
  const origin = appOrigin();
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["send", "status", "download"],
  };
}

async function readObject(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const json = (await req.json()) as unknown;
      if (json && typeof json === "object" && !Array.isArray(json)) {
        return json as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  try {
    const form = await req.formData();
    const out: Record<string, unknown> = {};
    const agentIds: string[] = [];
    let sawAgents = false;
    for (const [key, value] of form.entries()) {
      const text = typeof value === "string" ? value : value.name;
      if (key === "agent_ids" || key === "agent_ids[]") {
        sawAgents = true;
        if (text) agentIds.push(text);
        continue;
      }
      out[key] = text;
    }
    if (sawAgents) out.agent_ids = agentIds;
    return out;
  } catch {
    return {};
  }
}

async function readTokenParams(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const json = (await req.json()) as unknown;
      if (!json || typeof json !== "object" || Array.isArray(json)) return {};
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
        if (typeof value === "string") out[key] = value;
      }
      return out;
    } catch {
      return {};
    }
  }
  const text = await req.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) out[key] = value;
  return out;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function agentIdsFrom(body: Record<string, unknown>): string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, "agent_ids")) return undefined;
  const raw = body.agent_ids;
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === "string" && Boolean(id));
  }
  if (typeof raw === "string" && raw) return [raw];
  return [];
}

function redirectUrisOk(uris: unknown): uris is string[] {
  return (
    Array.isArray(uris) &&
    uris.length > 0 &&
    uris.every((u) => typeof u === "string" && u.length > 0)
  );
}

function loginNext(body: Record<string, unknown>): string {
  const q = new URLSearchParams();
  const clientId = asString(body.client_id);
  const redirectUri = asString(body.redirect_uri);
  const state = asString(body.state);
  const challenge = asString(body.code_challenge);
  const resource = asString(body.resource);
  if (clientId) q.set("client_id", clientId);
  if (redirectUri) q.set("redirect_uri", redirectUri);
  if (state) q.set("state", state);
  if (challenge) q.set("code_challenge", challenge);
  if (resource) q.set("resource", resource);
  const next = `/oauth/authorize${q.size ? `?${q.toString()}` : ""}`;
  return `/login?next=${encodeURIComponent(safeNext(next))}`;
}

export async function postRegister(req: Request): Promise<Response> {
  const body = await readObject(req);
  const nameRaw = asString(body.client_name);
  const clientName = nameRaw || "MCP client";
  const method = asString(body.token_endpoint_auth_method) || "none";
  if (method !== "none") {
    return jsonError(400, "invalid_client_metadata", "public clients must use none");
  }
  if (!redirectUrisOk(body.redirect_uris)) {
    return jsonError(400, "invalid_client_metadata", "redirect_uris required");
  }
  const db = requireDb();
  const clientId = randomUUID();
  await db.insert(oauthClients).values({
    clientId,
    clientName,
    redirectUris: body.redirect_uris,
    authMethod: "none",
  });
  return Response.json(
    {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: body.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}

async function resolveAllowedAgentIds(
  db: AuditDb,
  userId: string,
  requested: string[] | undefined,
): Promise<string[]> {
  const cabinet = await cabinetForUser(db, userId);
  if (!cabinet.entitled) return [];
  const active = await db
    .select()
    .from(agents)
    .where(and(eq(agents.ownerUserId, cabinet.ownerUserId), isNull(agents.revokedAt)));
  const allowed = new Set(active.map((row) => row.id));
  if (requested === undefined) return active.map((row) => row.id);
  return requested.filter((id) => allowed.has(id));
}

function clientAllowsRedirect(client: OauthClientRow, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}

export async function postAuthorize(req: Request): Promise<Response> {
  const body = await readObject(req);
  const clientId = asString(body.client_id);
  const redirectUri = asString(body.redirect_uri);
  const state = asString(body.state);
  const codeChallenge = asString(body.code_challenge);
  const method = asString(body.code_challenge_method) || "S256";
  const resource = asString(body.resource) || mcpResource();

  if (!clientId) return jsonError(400, "invalid_request", "client_id required");
  const db = requireDb();
  const resolved = await resolveOauthClient(db, clientId);
  if (!resolved.ok) {
    return jsonError(400, "invalid_client", resolved.error);
  }
  if (!redirectUri || !clientAllowsRedirect(resolved.client, redirectUri)) {
    return jsonError(400, "invalid_request", "redirect_uri is not registered");
  }
  if (method !== "S256") {
    return jsonError(400, "invalid_request", "code_challenge_method must be S256");
  }
  if (!codeChallenge) {
    return jsonError(400, "invalid_request", "code_challenge required");
  }
  if (resource !== mcpResource()) {
    return jsonError(400, "invalid_target", "resource must be this MCP");
  }

  const cookie = req.headers.get("cookie");
  const user = await getAuth().userFromCookie(cookie);
  if (!user) {
    return new Response(null, {
      status: 302,
      headers: { location: loginNext(body) },
    });
  }
  await ensureAccount(db, user);

  const allowedAgentIds = await resolveAllowedAgentIds(
    db,
    user.id,
    agentIdsFrom(body),
  );
  const code = await insertAuthorizationCode(db, {
    userId: user.id,
    clientId: resolved.client.clientId,
    redirectUri,
    codeChallenge,
    resource,
    allowedAgentIds,
  });

  const dest = new URL(redirectUri);
  dest.searchParams.set("code", code);
  if (state) dest.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { location: dest.toString() },
  });
}

function tokenResponse(tokens: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): Response {
  return Response.json({
    access_token: tokens.access_token,
    token_type: "Bearer",
    expires_in: tokens.expires_in,
    refresh_token: tokens.refresh_token,
    scope: "send status download",
  });
}

export async function postToken(req: Request): Promise<Response> {
  const params = await readTokenParams(req);
  const grantType = params.grant_type ?? "";
  const resource = (params.resource ?? "").trim() || mcpResource();
  if (resource !== mcpResource()) {
    return jsonError(400, "invalid_target", "resource must be this MCP");
  }
  const db = requireDb();

  if (grantType === "authorization_code") {
    const code = params.code ?? "";
    const redirectUri = params.redirect_uri ?? "";
    const clientId = params.client_id ?? "";
    const verifier = params.code_verifier ?? "";
    if (!code || !redirectUri || !clientId || !verifier) {
      return jsonError(400, "invalid_request", "code, redirect_uri, client_id, code_verifier required");
    }
    const consumed = await consumeAuthorizationCode(db, code);
    if (!consumed) return jsonError(400, "invalid_grant", "code is invalid");
    if (consumed.clientId !== clientId || consumed.redirectUri !== redirectUri) {
      return jsonError(400, "invalid_grant", "code does not match client");
    }
    if (consumed.resource !== resource) {
      return jsonError(400, "invalid_target", "resource does not match authorization");
    }
    if (!pkceMatches(verifier, consumed.codeChallenge)) {
      return jsonError(400, "invalid_grant", "PKCE verification failed");
    }
    const tokens = await issueGrantTokens(db, {
      userId: consumed.userId,
      clientId: consumed.clientId,
      allowedAgentIds: consumed.allowedAgentIds ?? [],
      resource: consumed.resource,
    });
    return tokenResponse(tokens);
  }

  if (grantType === "refresh_token") {
    const refresh = params.refresh_token ?? "";
    if (!refresh) return jsonError(400, "invalid_request", "refresh_token required");
    const grant = await lookupOauthGrantByRefresh(db, refresh);
    if (!grant) return jsonError(400, "invalid_grant", "refresh token is invalid");
    if (grant.resource !== resource) {
      return jsonError(400, "invalid_target", "resource does not match grant");
    }
    const tokens = await rotateGrantTokens(db, grant);
    return tokenResponse(tokens);
  }

  return jsonError(400, "unsupported_grant_type");
}
