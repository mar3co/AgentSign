import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getEnv } from "../env.js";
import { logEvent, type AuditDb } from "./audit.js";
import { getDeps } from "./deps.js";

const WEBHOOK_TIMEOUT_MS = 5_000;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
  "metadata.goog",
]);

export type EnvelopeCompletedPayload = {
  event: "envelope.completed";
  id: string;
  status: string;
  sha256: string;
  shred_at: Date;
};

/** HMAC key returned once as webhook_secret; stored encrypted at rest. */
export function newWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

function kek(): Buffer {
  const env = getEnv();
  const material = env.CRON_SECRET || env.APP_URL || "sign-dev-webhook-kek";
  return createHash("sha256").update(material).digest();
}

export function sealWebhookSecret(raw: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek(), iv);
  const enc = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function openWebhookSecret(stored: string): string {
  if (!stored.startsWith("enc:")) return stored;
  const parts = stored.split(":");
  if (parts.length !== 4) return stored;
  const [, ivH, tagH, dataH] = parts;
  const decipher = createDecipheriv("aes-256-gcm", kek(), Buffer.from(ivH!, "hex"));
  decipher.setAuthTag(Buffer.from(tagH!, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataH!, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeHost(host: string): string {
  let h = host.replace(/\.$/, "").toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h;
}

function mappedIpv4(host: string): string | null {
  const lower = host.toLowerCase();
  if (!lower.startsWith("::ffff:")) return null;
  const rest = lower.slice("::ffff:".length);
  if (isIP(rest) === 4) return rest;
  const m = rest.match(/^([0-9a-f]+):([0-9a-f]+)$/i);
  if (!m) return null;
  const hi = parseInt(m[1]!, 16);
  const lo = parseInt(m[2]!, 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

function isBlockedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const oct = parts.map((p) => Number(p));
  if (oct.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const a = oct[0]!;
  const b = oct[1]!;
  if (a === 0 || a === 10 || a === 127 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isBlockedIp(host: string): boolean {
  const mapped = mappedIpv4(host);
  if (mapped) return isBlockedIpv4(mapped);
  const version = isIP(host);
  if (version === 4) return isBlockedIpv4(host);
  if (version === 6) {
    const h = host.toLowerCase();
    if (h === "::" || h === "::1") return true;
    if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
    if (h.startsWith("::ffff:")) return isBlockedIp(h.slice("::ffff:".length));
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isBlockedIpv4(host);
  return false;
}

async function resolveHost(host: string): Promise<{ address: string; family: number }[]> {
  if (isIP(host)) return [{ address: host, family: isIP(host) }];
  const custom = getDeps().lookup;
  if (custom) return custom(host);
  try {
    const rows = await dnsLookup(host, { all: true, verbatim: true });
    return rows.map((r) => ({ address: r.address, family: r.family }));
  } catch {
    return [];
  }
}

/** Reject non-https, localhost, private/link-local/metadata targets (SSRF). */
export async function webhookUrlError(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid webhook URL";
  }
  if (parsed.protocol !== "https:") return "Webhook URL must be https";
  const host = normalizeHost(parsed.hostname);
  if (!host) return "Invalid webhook URL";
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost")) {
    return "Webhook URL is not allowed";
  }
  if (isBlockedIp(host)) return "Webhook URL is not allowed";
  const resolved = await resolveHost(host);
  if (resolved.length === 0) return "Webhook URL is not allowed";
  for (const row of resolved) {
    const addr = normalizeHost(row.address);
    if (isBlockedIp(addr)) return "Webhook URL is not allowed";
  }
  return null;
}

export function webhookSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  const hex = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `sha256=${hex}`;
}

function doFetch(input: string, init: RequestInit): Promise<Response> {
  const f = getDeps().fetch ?? globalThis.fetch;
  return f(input, init);
}

function now(): Date {
  return getDeps().now?.() ?? new Date();
}

/** One POST; failures audit webhook_failed and do not throw. */
export async function fireEnvelopeCompleted(
  db: AuditDb,
  envelope: {
    id: string;
    webhookUrl: string | null;
    webhookSecretHash: string | null;
  },
  payload: EnvelopeCompletedPayload,
): Promise<void> {
  if (!envelope.webhookUrl || !envelope.webhookSecretHash) return;
  const blocked = await webhookUrlError(envelope.webhookUrl);
  if (blocked) {
    await logEvent(db, {
      envelopeId: envelope.id,
      event: "webhook_failed",
      payload: { error: "blocked_url" },
    });
    return;
  }

  const body = {
    event: payload.event,
    id: payload.id,
    status: payload.status,
    sha256: payload.sha256,
    shred_at: payload.shred_at.toISOString(),
  };
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(now().getTime() / 1000));
  const secret = openWebhookSecret(envelope.webhookSecretHash);
  const signature = webhookSignature(secret, timestamp, rawBody);

  try {
    const res = await doFetch(envelope.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sign-Timestamp": timestamp,
        "X-Sign-Signature": signature,
      },
      body: rawBody,
      redirect: "error",
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      await logEvent(db, {
        envelopeId: envelope.id,
        event: "webhook_failed",
        payload: { status: res.status },
      });
      return;
    }
    await logEvent(db, {
      envelopeId: envelope.id,
      event: "webhook_sent",
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "webhook_failed";
    await logEvent(db, {
      envelopeId: envelope.id,
      event: "webhook_failed",
      payload: { error },
    });
  }
}
