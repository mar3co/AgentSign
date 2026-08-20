import { getDb } from "../db/client.js";
import { getAuth } from "../lib/auth/supabase.js";
import { getDeps } from "../lib/deps.js";
import { claimSends, ensureAccount } from "../lib/keys.js";
import type { AuditDb } from "../lib/audit.js";

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function requireDb(): AuditDb {
  return getDeps().db ?? getDb();
}

function originOf(req: Request): string {
  return new URL(req.url).origin;
}

function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
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
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": result.cookie,
      },
    });
  }
  const next = safeNext(body.next);
  const emailRedirectTo = `${originOf(req)}/auth/callback?next=${encodeURIComponent(next)}`;
  await auth.sendMagicLink({ email, emailRedirectTo });
  return Response.json({ ok: true });
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

export async function getLoginOAuth(
  req: Request,
  provider: "google" | "github",
): Promise<Response> {
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const redirectTo = `${originOf(req)}/auth/callback?next=${encodeURIComponent(next)}`;
  const { url } = await getAuth().startOAuth({ provider, redirectTo });
  return new Response(null, { status: 302, headers: { location: url } });
}

export async function getAuthCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (!code) return jsonError(400, "Missing code", "invalid_request");
  const exchanged = await getAuth().exchangeCode(code);
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
