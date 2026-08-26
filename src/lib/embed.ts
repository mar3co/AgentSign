import { isBlockedWebhookHost } from "./webhooks.js";

export function parseEmbedOrigin(
  raw: string,
): { ok: true; origin: string } | { ok: false; code: "embed_origin_invalid" } {
  const fail = { ok: false as const, code: "embed_origin_invalid" as const };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return fail;
  }
  if (url.search || url.hash) return fail;
  if (url.pathname && url.pathname !== "/") return fail;

  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  const localHttp =
    url.protocol === "http:" &&
    (host === "localhost" || host === "127.0.0.1");
  if (url.protocol === "https:") {
    if (isBlockedWebhookHost(host)) return fail;
  } else if (!localHttp) {
    return fail;
  }

  return { ok: true, origin: url.origin };
}
