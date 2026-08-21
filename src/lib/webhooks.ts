import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { agents, signers as signersTable } from "../db/schema.js";
import { getEnv } from "../env.js";
import { logEvent, type AuditDb } from "./audit.js";
import { getDeps } from "./deps.js";

const v6Blocks = new BlockList();
v6Blocks.addAddress("::", "ipv6");
v6Blocks.addAddress("::1", "ipv6");
v6Blocks.addSubnet("fe80::", 10, "ipv6");
v6Blocks.addSubnet("fc00::", 7, "ipv6");
v6Blocks.addSubnet("::ffff:0:0", 96, "ipv6");

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

function kek(): Buffer | null {
  const env = getEnv();
  const material = env.WEBHOOK_KEK.trim() || env.CRON_SECRET.trim();
  if (!material) return null;
  return createHash("sha256").update(material).digest();
}

export function sealWebhookSecret(raw: string): string {
  const key = kek();
  if (!key) throw new Error("WEBHOOK_KEK or CRON_SECRET is required");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function openWebhookSecret(stored: string): string {
  if (!stored.startsWith("enc:")) {
    throw new Error("webhook secret is not encrypted");
  }
  const key = kek();
  if (!key) throw new Error("WEBHOOK_KEK or CRON_SECRET is required");
  const parts = stored.split(":");
  if (parts.length !== 4) throw new Error("webhook secret is not encrypted");
  const [, ivH, tagH, dataH] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivH!, "hex"));
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
    if (v6Blocks.check(host, "ipv6")) return true;
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

async function pinnedFetch(
  input: string,
  init: RequestInit,
  addresses: { address: string; family: number }[],
): Promise<Response> {
  const injected = getDeps().fetch;
  if (injected) return injected(input, init);
  const { Agent, fetch: undiciFetch } = await import("undici");
  const parsed = new URL(input);
  const pinnedHost = normalizeHost(parsed.hostname);
  const mapped = addresses.map((a) => ({
    address: a.address,
    family: (a.family === 6 ? 6 : 4) as 4 | 6,
  }));
  const agent = new Agent({
    connect: {
      lookup(hostname, _opts, cb) {
        const h = normalizeHost(hostname);
        if (h === pinnedHost || hostname === parsed.hostname) {
          (cb as (err: Error | null, result: typeof mapped) => void)(null, mapped);
          return;
        }
        cb(new Error("refusing unpinned lookup"), "", 4);
      },
    },
  });
  return undiciFetch(input, {
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: typeof init.body === "string" ? init.body : undefined,
    redirect: "error",
    signal: init.signal,
    dispatcher: agent,
  }) as unknown as Response;
}

/**
 * HTTPS fetch after SSRF denylist, a second resolve, and DNS pin so a TTL=0
 * rebind cannot hit a private IP on the real connection.
 */
export async function pinnedHttpsFetch(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; response: Response } | { ok: false; error: string }> {
  const blocked = await webhookUrlError(url);
  if (blocked) return { ok: false, error: blocked };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid webhook URL" };
  }
  const resolved = await resolveHost(normalizeHost(parsed.hostname));
  if (
    resolved.length === 0 ||
    resolved.some((row) => isBlockedIp(normalizeHost(row.address)))
  ) {
    return { ok: false, error: "Webhook URL is not allowed" };
  }
  try {
    const response = await pinnedFetch(
      url,
      {
        method: init.method,
        headers: init.headers,
        body: init.body,
        redirect: "error",
        signal: init.signal ?? AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      },
      resolved,
    );
    return { ok: true, response };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

function now(): Date {
  return getDeps().now?.() ?? new Date();
}

async function auditWebhook(
  db: AuditDb | undefined,
  envelopeId: string,
  event: "webhook_sent" | "webhook_failed",
  payload?: Record<string, unknown>,
): Promise<void> {
  if (!db) return;
  await logEvent(db, { envelopeId, event, payload });
}

/** One POST; failures audit webhook_failed (when db is available) and do not throw. */
async function postSignedWebhook(
  url: string,
  secretHash: string,
  rawBody: string,
  envelopeId: string,
  db?: AuditDb,
): Promise<void> {
  const blocked = await webhookUrlError(url);
  if (blocked) {
    await auditWebhook(db, envelopeId, "webhook_failed", { error: "blocked_url" });
    return;
  }
  const timestamp = String(Math.floor(now().getTime() / 1000));
  try {
    const secret = openWebhookSecret(secretHash);
    const signature = webhookSignature(secret, timestamp, rawBody);
    const parsed = new URL(url);
    const resolved = await resolveHost(normalizeHost(parsed.hostname));
    if (resolved.length === 0 || resolved.some((row) => isBlockedIp(normalizeHost(row.address)))) {
      await auditWebhook(db, envelopeId, "webhook_failed", { error: "blocked_url" });
      return;
    }
    const res = await pinnedFetch(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sign-Timestamp": timestamp,
          "X-Sign-Signature": signature,
        },
        body: rawBody,
        redirect: "error",
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      },
      resolved,
    );
    if (!res.ok) {
      await auditWebhook(db, envelopeId, "webhook_failed", { status: res.status });
      return;
    }
    await auditWebhook(db, envelopeId, "webhook_sent");
  } catch (err) {
    const error = err instanceof Error ? err.message : "webhook_failed";
    await auditWebhook(db, envelopeId, "webhook_failed", { error });
  }
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
  const body = {
    event: payload.event,
    id: payload.id,
    status: payload.status,
    sha256: payload.sha256,
    shred_at: payload.shred_at.toISOString(),
  };
  await postSignedWebhook(
    envelope.webhookUrl,
    envelope.webhookSecretHash,
    JSON.stringify(body),
    envelope.id,
    db,
  );
}

async function deliverAgentWebhook(
  db: AuditDb | undefined,
  agent: { webhookUrl: string | null; webhookSecretHash: string | null },
  payload: { event: string; id: string; agent: string; status: string },
): Promise<void> {
  if (!agent.webhookUrl || !agent.webhookSecretHash) return;
  const body = {
    event: payload.event,
    id: payload.id,
    agent: payload.agent,
    status: payload.status,
  };
  await postSignedWebhook(
    agent.webhookUrl,
    agent.webhookSecretHash,
    JSON.stringify(body),
    payload.id,
    db,
  );
}

export async function fireAgentWebhook(
  agent: { webhookUrl: string | null; webhookSecretHash: string | null },
  payload: { event: string; id: string; agent: string; status: string },
): Promise<void> {
  await deliverAgentWebhook(getDeps().db, agent, payload);
}

export async function fireAgentPartyReady(
  db: AuditDb,
  envelope: { id: string; status: string },
  party: { kind: string; agentId: string | null },
): Promise<void> {
  if (party.kind !== "agent" || !party.agentId) return;
  const [agent] = await db.select().from(agents).where(eq(agents.id, party.agentId));
  if (!agent) return;
  await deliverAgentWebhook(db, agent, {
    event: "party.ready",
    id: envelope.id,
    agent: agent.slug,
    status: envelope.status,
  });
}

export async function fireAgentPartyWebhooks(
  db: AuditDb,
  envelopeId: string,
  payload: { event: string; status: string },
): Promise<void> {
  const parties = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.envelopeId, envelopeId));
  const agentIds = [
    ...new Set(
      parties
        .filter((p) => p.kind === "agent" && p.agentId)
        .map((p) => p.agentId!),
    ),
  ];
  if (agentIds.length === 0) return;
  const rows = await db.select().from(agents).where(inArray(agents.id, agentIds));
  for (const agent of rows) {
    await deliverAgentWebhook(db, agent, {
      event: payload.event,
      id: envelopeId,
      agent: agent.slug,
      status: payload.status,
    });
  }
}
