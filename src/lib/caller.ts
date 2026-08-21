import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accounts } from "../db/schema.js";
import type { AuditDb } from "./audit.js";
import { getAuth } from "./auth/supabase.js";
import { getDeps } from "./deps.js";
import { ensureAccount, lookupApiKey } from "./keys.js";
import { accountForOauthGrant, lookupOauthGrant } from "./oauth.js";

export type CallerOk = {
  ok: true;
  db: AuditDb;
  user: { id: string; email: string };
  via: "session" | "live" | "agent" | "oauth";
  agentId?: string;
  keyPrefix?: string;
  allowedAgentIds?: string[];
  oauthClientId?: string;
  oauthClientName?: string;
};

export type CallerFail = { ok: false; response: Response };

export type RequireCallerOpts = {
  /** Allow `sign_agent_` paste keys (attest/reject only). */
  allowAgent?: boolean;
};

function unauthorized(): CallerFail {
  return {
    ok: false,
    response: Response.json(
      { error: "Unauthorized", code: "unauthorized" },
      { status: 401 },
    ),
  };
}

function hasApiKeyQuery(req: Request): boolean {
  return new URL(req.url).searchParams.has("apiKey");
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

/**
 * Live key, account OAuth (`sign_oauth_`), or session by default. Pass
 * `{ allowAgent: true }` for attest/reject so `sign_agent_` keys are accepted.
 * Rejects `?apiKey=`, tmp keys, and missing auth.
 */
export async function requireCaller(
  req: Request,
  opts?: RequireCallerOpts,
): Promise<CallerOk | CallerFail> {
  if (hasApiKeyQuery(req)) return unauthorized();

  const db = getDeps().db ?? getDb();
  const at = getDeps().now?.() ?? new Date();
  const raw = bearerToken(req);

  if (raw) {
    if (opts?.allowAgent && raw.startsWith("sign_agent_")) {
      const key = await lookupApiKey(db, raw);
      if (
        !key ||
        key.kind !== "agent" ||
        !key.userId ||
        !key.agentId ||
        key.expiresAt.getTime() <= at.getTime()
      ) {
        return unauthorized();
      }
      const [account] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, key.userId));
      const email = account?.email?.trim().toLowerCase();
      if (!email) return unauthorized();
      return {
        ok: true,
        db,
        user: { id: key.userId, email },
        via: "agent",
        agentId: key.agentId,
        keyPrefix: key.prefix,
      };
    }
    if (raw.startsWith("sign_oauth_")) {
      const grant = await lookupOauthGrant(db, raw);
      if (!grant) return unauthorized();
      const account = await accountForOauthGrant(db, grant);
      if (!account) return unauthorized();
      return {
        ok: true,
        db,
        user: { id: account.id, email: account.email },
        via: "oauth",
        allowedAgentIds: grant.allowedAgentIds ?? [],
        oauthClientId: grant.clientId,
        oauthClientName: account.clientName ?? undefined,
      };
    }
    if (!raw.startsWith("sign_live_")) return unauthorized();
    const key = await lookupApiKey(db, raw);
    if (
      !key ||
      key.kind !== "live" ||
      !key.userId ||
      key.expiresAt.getTime() <= at.getTime()
    ) {
      return unauthorized();
    }
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, key.userId));
    const email = account?.email?.trim().toLowerCase();
    if (!email) return unauthorized();
    return {
      ok: true,
      db,
      user: { id: key.userId, email },
      via: "live",
    };
  }

  const cookie = req.headers.get("cookie");
  if (!cookie) return unauthorized();
  const user = await getAuth().userFromCookie(cookie);
  if (!user) return unauthorized();
  await ensureAccount(db, user);
  return {
    ok: true,
    db,
    user: { id: user.id, email: user.email },
    via: "session",
  };
}
