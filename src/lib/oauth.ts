import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  accounts,
  oauthClients,
  oauthCodes,
  oauthGrants,
} from "../db/schema.js";
import { appOrigin } from "../env.js";
import type { AuditDb } from "./audit.js";
import { getDeps } from "./deps.js";
import { equalHex, sha256Hex } from "./hash.js";
import { newOauthToken } from "./tokens.js";
import { webhookUrlError } from "./webhooks.js";

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
  return `Bearer resource_metadata="${appOrigin()}/.well-known/oauth-protected-resource", scope="send status download"`;
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
  const blocked = await webhookUrlError(clientIdUrl);
  if (blocked) return { error: blocked };
  const fetchFn = getDeps().fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(clientIdUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
    });
  } catch {
    return { error: "Client metadata fetch failed" };
  }
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
    obj.redirect_uris.some((u) => typeof u !== "string" || !u)
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

export async function consumeAuthorizationCode(
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
  const at = now();
  if (row.expiresAt.getTime() <= at.getTime()) return null;
  const [consumed] = await db
    .update(oauthCodes)
    .set({ consumedAt: at })
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
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const at = now();
  const access = newOauthToken();
  const refresh = newOauthToken();
  const expiresAt = new Date(at.getTime() + ACCESS_TTL_MS);
  await db
    .update(oauthGrants)
    .set({
      accessHash: access.hash,
      refreshHash: refresh.hash,
      expiresAt,
    })
    .where(eq(oauthGrants.id, grant.id));
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
