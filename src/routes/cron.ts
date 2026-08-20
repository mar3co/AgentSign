import { timingSafeEqual } from "node:crypto";
import { getDb } from "../db/client.js";
import { getEnv } from "../env.js";
import { getDeps, storeUnavailableResponse } from "../lib/deps.js";
import { createMailer, type Mailer } from "../lib/email.js";
import type { BlobStore } from "../lib/storage.js";
import { remindDue, shredDue } from "../jobs/shred.js";

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function requireDb() {
  return getDeps().db ?? getDb();
}

function requireStore(): BlobStore | null {
  return getDeps().store ?? null;
}

function requireMailer(): Mailer {
  return getDeps().mailer ?? createMailer();
}

function now(): Date {
  return getDeps().now?.() ?? new Date();
}

function cronAuthorized(req: Request): boolean {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Daily shred + reminder sweep. Bearer CRON_SECRET. */
export async function runShredCron(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }
  const db = requireDb();
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const mailer = requireMailer();
  const at = now();
  await shredDue(db, store, at);
  await remindDue(db, mailer, at);
  return Response.json({ ok: true });
}
