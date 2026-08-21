import { eq } from "drizzle-orm";
import { accounts } from "../db/schema.js";
import { brandingKey, parseLogo } from "../lib/branding.js";
import { cabinetForUser } from "../lib/cabinet.js";
import { requireCaller } from "../lib/caller.js";
import { getDeps, storeUnavailableResponse } from "../lib/deps.js";

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function brandingJson(
  cabinet: {
    displayName: string | null;
    logoPath: string | null;
    ownerUserId: string;
  },
  callerId: string,
): { display_name: string | null; has_logo: boolean; can_edit: boolean } {
  return {
    display_name: cabinet.displayName,
    has_logo: Boolean(cabinet.logoPath),
    can_edit: callerId === cabinet.ownerUserId,
  };
}

function parseDisplayName(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; response: Response } {
  if (typeof raw !== "string") {
    return {
      ok: false,
      response: jsonError(400, "display_name must be a string", "invalid_request"),
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > 80) {
    return {
      ok: false,
      response: jsonError(
        400,
        "display_name must be 80 characters or fewer",
        "invalid_request",
      ),
    };
  }
  return { ok: true, value: trimmed };
}

async function requireEntitledCabinet(req: Request) {
  const caller = await requireCaller(req, { allowOauth: false });
  if (!caller.ok) return caller;
  const cabinet = await cabinetForUser(caller.db, caller.user.id);
  if (!cabinet.entitled) {
    return {
      ok: false as const,
      response: jsonError(403, "Pro plan required", "pro_required"),
    };
  }
  return { ok: true as const, caller, cabinet };
}

function requireOwner(
  callerId: string,
  ownerUserId: string,
): { ok: true } | { ok: false; response: Response } {
  if (callerId !== ownerUserId) {
    return { ok: false, response: jsonError(403, "Forbidden", "forbidden") };
  }
  return { ok: true };
}

export async function getBranding(req: Request): Promise<Response> {
  const gate = await requireEntitledCabinet(req);
  if (!gate.ok) return gate.response;
  return Response.json(brandingJson(gate.cabinet, gate.caller.user.id));
}

export async function putBranding(req: Request): Promise<Response> {
  const gate = await requireEntitledCabinet(req);
  if (!gate.ok) return gate.response;
  const owner = requireOwner(gate.caller.user.id, gate.cabinet.ownerUserId);
  if (!owner.ok) return owner.response;

  let nextName: string | null | undefined;
  let logoBytes: Uint8Array | undefined;
  const ct = req.headers.get("content-type") ?? "";

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    if (form.has("display_name")) {
      const parsed = parseDisplayName(form.get("display_name"));
      if (!parsed.ok) return parsed.response;
      nextName = parsed.value;
    }
    const logo = form.get("logo");
    if (logo instanceof Blob) {
      const bytes = new Uint8Array(await logo.arrayBuffer());
      if (bytes.length > 0) {
        if (!parseLogo(bytes).ok) {
          return jsonError(
            400,
            "Logo must be a PNG or JPEG under 256 KiB",
            "invalid_logo",
          );
        }
        logoBytes = bytes;
      }
    } else if (logo !== null) {
      return jsonError(400, "Logo must be a PNG or JPEG under 256 KiB", "invalid_logo");
    }
  } else {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError(400, "Invalid JSON", "invalid_request");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError(400, "Invalid JSON", "invalid_request");
    }
    if ("display_name" in body) {
      const parsed = parseDisplayName((body as { display_name: unknown }).display_name);
      if (!parsed.ok) return parsed.response;
      nextName = parsed.value;
    }
  }

  const patch: { displayName?: string | null; logoPath?: string | null } = {};
  if (nextName !== undefined) patch.displayName = nextName;
  if (logoBytes) {
    const store = getDeps().store;
    if (!store) return storeUnavailableResponse();
    const key = brandingKey(gate.cabinet.ownerUserId);
    await store.put(key, logoBytes);
    patch.logoPath = key;
  }
  if (Object.keys(patch).length > 0) {
    await gate.caller.db
      .update(accounts)
      .set(patch)
      .where(eq(accounts.userId, gate.cabinet.ownerUserId));
  }

  const updated = await cabinetForUser(gate.caller.db, gate.caller.user.id);
  return Response.json(brandingJson(updated, gate.caller.user.id));
}

export async function deleteBrandingLogo(req: Request): Promise<Response> {
  const gate = await requireEntitledCabinet(req);
  if (!gate.ok) return gate.response;
  const owner = requireOwner(gate.caller.user.id, gate.cabinet.ownerUserId);
  if (!owner.ok) return owner.response;

  const store = getDeps().store;
  if (!store) return storeUnavailableResponse();
  await store.delete(brandingKey(gate.cabinet.ownerUserId));
  await gate.caller.db
    .update(accounts)
    .set({ logoPath: null })
    .where(eq(accounts.userId, gate.cabinet.ownerUserId));

  const updated = await cabinetForUser(gate.caller.db, gate.caller.user.id);
  return Response.json(brandingJson(updated, gate.caller.user.id));
}
