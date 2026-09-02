import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  accounts,
  agents,
  oauthClients,
  oauthCodes,
  oauthGrants,
} from "../db/schema.js";
import { appOrigin } from "../env.js";
import type { AuditDb } from "./audit.js";
import { getDeps } from "./deps.js";
import { equalHex, sha256Hex } from "./hash.js";
import { newOauthToken } from "./tokens.js";
import { pinnedHttpsFetch } from "./webhooks.js";

/** Every grant carries the same three scopes; there is no per-grant subset. */
export const OAUTH_SCOPES = ["send", "status", "download"] as const;
export const OAUTH_SCOPE = OAUTH_SCOPES.join(" ");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const CIMD_TIMEOUT_MS = 5_000;

export type OauthGrantRow = typeof oauthGrants.$inferSelect;
export type OauthClientRow = typeof oauthClients.$inferSelect;

export type ClientMetadata = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
};

/** BASE64URL(SHA256(ASCII(verifier))) as in RFC 7636 S256. */
export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function mcpResource(): string {
  return `${appOrigin()}/mcp`;
}

export function oauthWwwAuthenticate(): string {
  return `Bearer resource_metadata="${appOrigin()}/.well-known/oauth-protected-resource", scope="${OAUTH_SCOPE}"`;
}

export function mcpUnauthorized(): Response {
  return Response.json(
    { error: "Unauthorized", code: "unauthorized" },
    {
      status: 401,
      headers: { "WWW-Authenticate": oauthWwwAuthenticate() },
    },
  );
}

export function redirectUriAllowed(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  const scheme = parsed.protocol.toLowerCase();
  if (
    scheme === "javascript:" ||
    scheme === "data:" ||
    scheme === "file:" ||
    scheme === "about:" ||
    scheme === "blob:" ||
    scheme === "vbscript:"
  ) {
    return false;
  }
  if (scheme === "https:") return true;
  if (scheme === "http:") {
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  }
  return /^[a-z][a-z0-9+.-]*:$/.test(scheme);
}

function equalStr(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function now(): Date {
  return getDeps().now?.() ?? new Date();
}

function requireDb(db?: AuditDb): AuditDb {
  return db ?? getDeps().db ?? getDb();
}

export async function fetchClientMetadata(
  clientIdUrl: string,
): Promise<ClientMetadata | { error: string }> {
  const got = await pinnedHttpsFetch(clientIdUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
  });
  if (!got.ok) return { error: got.error };
  const res = got.response;
  if (!res.ok) return { error: "Client metadata fetch failed" };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { error: "Client metadata is not JSON" };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { error: "Client metadata is invalid" };
  }
  const obj = json as Record<string, unknown>;
  if (obj.client_id !== clientIdUrl) {
    return { error: "client_id does not match" };
  }
  if (
    !Array.isArray(obj.redirect_uris) ||
    obj.redirect_uris.length === 0 ||
    obj.redirect_uris.some((u) => typeof u !== "string" || !u || !redirectUriAllowed(u))
  ) {
    return { error: "redirect_uris required" };
  }
  const name =
    typeof obj.client_name === "string" && obj.client_name.trim()
      ? obj.client_name.trim()
      : "MCP client";
  return {
    client_id: clientIdUrl,
    client_name: name,
    redirect_uris: obj.redirect_uris as string[],
  };
}

export async function lookupOauthGrant(
  db: AuditDb | undefined,
  raw: string,
): Promise<OauthGrantRow | null> {
  if (!raw.startsWith("sign_oauth_")) return null;
  const conn = requireDb(db);
  const hash = sha256Hex(raw);
  const [grant] = await conn
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.accessHash, hash));
  if (!grant?.accessHash || !equalHex(grant.accessHash, hash)) return null;
  if (grant.revokedAt) return null;
  const at = now();
  if (!grant.expiresAt || grant.expiresAt.getTime() <= at.getTime()) return null;
  return grant;
}

export async function lookupOauthGrantByRefresh(
  db: AuditDb | undefined,
  raw: string,
): Promise<OauthGrantRow | null> {
  if (!raw.startsWith("sign_oauth_")) return null;
  const conn = requireDb(db);
  const hash = sha256Hex(raw);
  const [grant] = await conn
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.refreshHash, hash));
  if (!grant?.refreshHash || !equalHex(grant.refreshHash, hash)) return null;
  if (grant.revokedAt) return null;
  return grant;
}

/** OAuth 2.1: presenting a rotated-away refresh token revokes the grant family. */
export async function revokeGrantOnRefreshReuse(
  db: AuditDb,
  raw: string,
): Promise<boolean> {
  if (!raw.startsWith("sign_oauth_")) return false;
  const hash = sha256Hex(raw);
  const [grant] = await db
    .select()
    .from(oauthGrants)
    .where(eq(oauthGrants.previousRefreshHash, hash));
  if (
    !grant?.previousRefreshHash ||
    !equalHex(grant.previousRefreshHash, hash)
  ) {
    return false;
  }
  if (grant.revokedAt) return true;
  await db
    .update(oauthGrants)
    .set({ revokedAt: now() })
    .where(eq(oauthGrants.id, grant.id));
  return true;
}

/** One connected MCP client, as shown in Settings > Security. */
export type GrantSummary = {
  id: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  agents: { id: string; slug: string; name: string }[];
  createdAt: Date;
};

/** Live grants for one person, newest first, with client and agent names. */
export async function listGrants(
  db: AuditDb | undefined,
  userId: string,
): Promise<GrantSummary[]> {
  const conn = requireDb(db);
  const rows = await conn
    .select()
    .from(oauthGrants)
    .where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt)));
  if (rows.length === 0) return [];

  const clientIds = [...new Set(rows.map((row) => row.clientId))];
  const clients = await conn
    .select()
    .from(oauthClients)
    .where(inArray(oauthClients.clientId, clientIds));
  const clientNames = new Map(clients.map((c) => [c.clientId, c.clientName]));

  const agentIds = [...new Set(rows.flatMap((row) => row.allowedAgentIds ?? []))];
  const agentRows = agentIds.length
    ? await conn.select().from(agents).where(inArray(agents.id, agentIds))
    : [];
  const agentById = new Map(agentRows.map((a) => [a.id, a]));

  return rows
    .map((row) => ({
      id: row.id,
      clientId: row.clientId,
      clientName: clientNames.get(row.clientId) ?? "MCP client",
      scopes: [...OAUTH_SCOPES],
      agents: (row.allowedAgentIds ?? []).flatMap((id) => {
        const agent = agentById.get(id);
        if (!agent || agent.revokedAt) return [];
        return [{ id: agent.id, slug: agent.slug, name: agent.name }];
      }),
      createdAt: row.createdAt,
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Disconnect one app. Kills the access token and the refresh family, the
 *  same way reuse detection does: every lookup rejects a revoked grant. */
export async function revokeGrant(
  db: AuditDb | undefined,
  userId: string,
  grantId: string,
): Promise<boolean> {
  if (!UUID_RE.test(grantId)) return false;
  const conn = requireDb(db);
  const [updated] = await conn
    .update(oauthGrants)
    .set({ revokedAt: now() })
    .where(
      and(
        eq(oauthGrants.id, grantId),
        eq(oauthGrants.userId, userId),
        isNull(oauthGrants.revokedAt),
      ),
    )
    .returning();
  return Boolean(updated);
}

/** RFC 7009: revoke the grant that owns this access or refresh token. */
export async function revokeGrantByToken(
  db: AuditDb | undefined,
  raw: string,
): Promise<boolean> {
  if (!raw.startsWith("sign_oauth_")) return false;
  const conn = requireDb(db);
  const hash = sha256Hex(raw);
  const [grant] = await conn
    .select()
    .from(oauthGrants)
    .where(
      or(
        eq(oauthGrants.accessHash, hash),
        eq(oauthGrants.refreshHash, hash),
        eq(oauthGrants.previousRefreshHash, hash),
      ),
    );
  if (!grant) return false;
  const matched = [
    grant.accessHash,
    grant.refreshHash,
    grant.previousRefreshHash,
  ].some((stored) => stored && equalHex(stored, hash));
  if (!matched) return false;
  if (grant.revokedAt) return true;
  await conn
    .update(oauthGrants)
    .set({ revokedAt: now() })
    .where(eq(oauthGrants.id, grant.id));
  return true;
}

export async function accountForOauthGrant(
  db: AuditDb,
  grant: OauthGrantRow,
): Promise<{ id: string; email: string; clientName: string | null } | null> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, grant.userId));
  const email = account?.email?.trim().toLowerCase();
  if (!email) return null;
  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, grant.clientId));
  return {
    id: grant.userId,
    email,
    clientName: client?.clientName ?? null,
  };
}

export async function upsertCimdClient(
  db: AuditDb,
  meta: ClientMetadata,
): Promise<OauthClientRow> {
  const [existing] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, meta.client_id));
  if (existing) {
    const [updated] = await db
      .update(oauthClients)
      .set({
        clientName: meta.client_name,
        redirectUris: meta.redirect_uris,
        authMethod: "none",
      })
      .where(eq(oauthClients.id, existing.id))
      .returning();
    return updated ?? existing;
  }
  const [row] = await db
    .insert(oauthClients)
    .values({
      clientId: meta.client_id,
      clientName: meta.client_name,
      redirectUris: meta.redirect_uris,
      authMethod: "none",
    })
    .returning();
  return row!;
}

export async function resolveOauthClient(
  db: AuditDb,
  clientId: string,
): Promise<{ ok: true; client: OauthClientRow } | { ok: false; error: string }> {
  if (clientId.startsWith("https:")) {
    const meta = await fetchClientMetadata(clientId);
    if ("error" in meta) return { ok: false, error: meta.error };
    const client = await upsertCimdClient(db, meta);
    return { ok: true, client };
  }
  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId));
  if (!client) return { ok: false, error: "Unknown client" };
  return { ok: true, client };
}

export function newAuthorizationCode(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: sha256Hex(raw) };
}

export async function insertAuthorizationCode(
  db: AuditDb,
  input: {
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    resource: string;
    allowedAgentIds: string[];
  },
): Promise<string> {
  const code = newAuthorizationCode();
  const at = now();
  await db.insert(oauthCodes).values({
    codeHash: code.hash,
    userId: input.userId,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    resource: input.resource,
    allowedAgentIds: input.allowedAgentIds,
    expiresAt: new Date(at.getTime() + CODE_TTL_MS),
  });
  return code.raw;
}

export async function lookupAuthorizationCode(
  db: AuditDb,
  raw: string,
): Promise<typeof oauthCodes.$inferSelect | null> {
  const hash = sha256Hex(raw);
  const [row] = await db
    .select()
    .from(oauthCodes)
    .where(eq(oauthCodes.codeHash, hash));
  if (!row || !equalHex(row.codeHash, hash)) return null;
  if (row.consumedAt) return null;
  if (row.expiresAt.getTime() <= now().getTime()) return null;
  return row;
}

export async function consumeAuthorizationCode(
  db: AuditDb,
  raw: string,
): Promise<typeof oauthCodes.$inferSelect | null> {
  const row = await lookupAuthorizationCode(db, raw);
  if (!row) return null;
  const [consumed] = await db
    .update(oauthCodes)
    .set({ consumedAt: now() })
    .where(and(eq(oauthCodes.id, row.id), isNull(oauthCodes.consumedAt)))
    .returning();
  return consumed ?? null;
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  return equalStr(pkceS256(verifier), challenge);
}

export async function issueGrantTokens(
  db: AuditDb,
  input: {
    userId: string;
    clientId: string;
    allowedAgentIds: string[];
    resource: string;
  },
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const at = now();
  const access = newOauthToken();
  const refresh = newOauthToken();
  const expiresAt = new Date(at.getTime() + ACCESS_TTL_MS);
  await db.insert(oauthGrants).values({
    userId: input.userId,
    clientId: input.clientId,
    allowedAgentIds: input.allowedAgentIds,
    accessHash: access.hash,
    refreshHash: refresh.hash,
    resource: input.resource,
    expiresAt,
  });
  return {
    access_token: access.raw,
    refresh_token: refresh.raw,
    expires_in: 3600,
  };
}

export async function rotateGrantTokens(
  db: AuditDb,
  grant: OauthGrantRow,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
} | null> {
  if (!grant.refreshHash) return null;
  const at = now();
  const access = newOauthToken();
  const refresh = newOauthToken();
  const expiresAt = new Date(at.getTime() + ACCESS_TTL_MS);
  const [updated] = await db
    .update(oauthGrants)
    .set({
      accessHash: access.hash,
      refreshHash: refresh.hash,
      previousRefreshHash: grant.refreshHash,
      expiresAt,
    })
    .where(
      and(eq(oauthGrants.id, grant.id), eq(oauthGrants.refreshHash, grant.refreshHash)),
    )
    .returning();
  if (!updated) return null;
  return {
    access_token: access.raw,
    refresh_token: refresh.raw,
    expires_in: 3600,
  };
}

export function looksLikeJwt(token: string): boolean {
  if (token.startsWith("sign_")) return false;
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}
