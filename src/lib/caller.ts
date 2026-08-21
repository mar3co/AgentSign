import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accounts } from "../db/schema.js";
import type { AuditDb } from "./audit.js";
import { getAuth } from "./auth/supabase.js";
import { getDeps } from "./deps.js";
import { ensureAccount, lookupApiKey } from "./keys.js";

export type CallerOk = {
  ok: true;
  db: AuditDb;
  user: { id: string; email: string };
  via: "session" | "live";
};

export type CallerFail = { ok: false; response: Response };

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
 * Live key or session only. Rejects `?apiKey=`, tmp keys, and missing auth.
 */
export async function requireCaller(
  req: Request,
): Promise<CallerOk | CallerFail> {
  if (hasApiKeyQuery(req)) return unauthorized();

  const db = getDeps().db ?? getDb();
  const at = getDeps().now?.() ?? new Date();
  const raw = bearerToken(req);

  if (raw) {
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
