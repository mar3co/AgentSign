import { getDb } from "../db/client.js";
import { getAuth } from "../lib/auth/supabase.js";
import type { AuditDb } from "../lib/audit.js";
import { getDeps } from "../lib/deps.js";
import { claimSends, ensureAccount, mintLiveKey } from "../lib/keys.js";

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function requireDb(): AuditDb {
  return getDeps().db ?? getDb();
}

export async function createLiveKey(req: Request): Promise<Response> {
  if (new URL(req.url).searchParams.has("apiKey")) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }
  const cookie = req.headers.get("cookie");
  if (!cookie) return jsonError(401, "Unauthorized", "unauthorized");
  const user = await getAuth().userFromCookie(cookie);
  if (!user) return jsonError(401, "Unauthorized", "unauthorized");
  const db = requireDb();
  await ensureAccount(db, user);
  await claimSends(db, user.id, user.email);

  let expiresInDays: number | undefined;
  try {
    const body = (await req.json()) as { expires_in_days?: unknown };
    if (typeof body.expires_in_days === "number") {
      if (!Number.isFinite(body.expires_in_days) || body.expires_in_days <= 0) {
        return jsonError(400, "expires_in_days must be positive", "invalid_request");
      }
      expiresInDays = body.expires_in_days;
    }
  } catch {
    // empty / non-JSON body: default expiry
  }

  const minted = await mintLiveKey(db, user.id, {
    expiresInDays,
    now: getDeps().now?.() ?? new Date(),
  });
  return Response.json(
    {
      key: minted.raw,
      prefix: minted.prefix,
      expires_at: minted.expiresAt.toISOString(),
    },
    { status: 201 },
  );
}
