import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
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

/** HMAC key returned once as webhook_secret; stored in webhook_secret_hash. */
export function newWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

function normalizeHost(host: string): string {
  return host.replace(/\.$/, "").toLowerCase();
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

/** Reject non-https, localhost, private/link-local/metadata targets (SSRF). */
export function webhookUrlError(url: string): string | null {
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
  const blocked = webhookUrlError(envelope.webhookUrl);
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
  const signature = webhookSignature(
    envelope.webhookSecretHash,
    timestamp,
    rawBody,
  );

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
