import { getDb } from "../db/client.js";
import { appOrigin, getEnv } from "../env.js";
import { clearedSessionCookies, getAuth } from "../lib/auth/supabase.js";
import { getDeps } from "../lib/deps.js";
import { claimSends, ensureAccount } from "../lib/keys.js";
import { safeNext } from "../lib/safeNext.js";
import type { AuditDb } from "../lib/audit.js";

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function requireDb(): AuditDb {
  return getDeps().db ?? getDb();
}

function originOf(req: Request): string {
  const env = getEnv();
  if (env.APP_URL || env.APP_ORIGIN) return appOrigin();
  return new URL(req.url).origin;
}

function cookieHeaders(cookies: string[] | undefined, extra?: string): Headers {
  const headers = new Headers();
  if (extra) headers.append("set-cookie", extra);
  for (const c of cookies ?? []) headers.append("set-cookie", c);
  return headers;
}

export async function postLogin(req: Request): Promise<Response> {
  let body: { email?: string; password?: string; next?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  const email = String(body.email ?? "").trim();
  if (!email) return jsonError(400, "Email is required", "invalid_request");
  const auth = getAuth();
  if (body.password) {
    const result = await auth.signInWithPassword({
      email,
      password: body.password,
    });
    if (!result.ok) return jsonError(401, result.error, result.code);
    const db = requireDb();
    await ensureAccount(db, result.user);
    await claimSends(db, result.user.id, result.user.email);
    return new Response(JSON.stringify({ ok: true, next: safeNext(body.next) }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": result.cookie,
      },
    });
  }
  const next = safeNext(body.next);
  const emailRedirectTo = `${originOf(req)}/auth/callback?next=${encodeURIComponent(next)}`;
  const mailed = await auth.sendMagicLink({ email, emailRedirectTo });
  const pkceCookies =
    mailed && typeof mailed === "object" ? mailed.cookies : undefined;
  const headers = cookieHeaders(pkceCookies);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function postSignup(req: Request): Promise<Response> {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return jsonError(400, "Email and password are required", "invalid_request");
  }
  const result = await getAuth().signUp({ email, password });
  if (!result.ok) return jsonError(400, result.error, result.code);
  return Response.json({ ok: true });
}

export async function getWhoami(req: Request): Promise<Response> {
  const user = await getAuth().userFromCookie(req.headers.get("cookie"));
  if (!user) return jsonError(401, "Unauthorized", "unauthorized");
  return Response.json({ email: user.email });
}

export function postLogout(): Response {
  const headers = cookieHeaders(clearedSessionCookies());
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function getLoginOAuth(
  req: Request,
  provider: "google" | "github",
): Promise<Response> {
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const redirectTo = `${originOf(req)}/auth/callback?next=${encodeURIComponent(next)}`;
  const started = await getAuth().startOAuth({ provider, redirectTo });
  const headers = cookieHeaders(started.cookies);
  headers.set("location", started.url);
  return new Response(null, { status: 302, headers });
}

export async function getAuthCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (!code) return jsonError(400, "Missing code", "invalid_request");
  const exchanged = await getAuth().exchangeCode(code, req.headers.get("cookie"));
  if (!exchanged) return jsonError(401, "Unauthorized", "unauthorized");
  const db = requireDb();
  await ensureAccount(db, exchanged.user);
  await claimSends(db, exchanged.user.id, exchanged.user.email);
  return new Response(null, {
    status: 302,
    headers: {
      location: next,
      "set-cookie": exchanged.cookie,
    },
  });
}
