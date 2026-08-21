import { randomUUID } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  documents,
  envelopes,
  packetRoles,
  packets,
  signers as signersTable,
} from "../db/schema.js";
import type { AuditDb } from "../lib/audit.js";
import { cabinetForUser, type Cabinet } from "../lib/cabinet.js";
import { requireCaller } from "../lib/caller.js";
import { getDeps, storeUnavailableResponse } from "../lib/deps.js";
import { PACKET_CAP } from "../lib/entitlement.js";
import { objectKey } from "../lib/storage.js";
import { createEnvelope } from "./envelopes.js";

const PDF_MAX_BYTES = 20 * 1024 * 1024;

type PacketRow = typeof packets.$inferSelect;
type RoleRow = typeof packetRoles.$inferSelect;

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function packetObjectKey(id: string): string {
  return `packets/${id}/original.pdf`;
}

function isPdf(bytes: Uint8Array, type: string): boolean {
  const magic =
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46;
  return magic || type === "application/pdf";
}

function packetJson(packet: PacketRow, roles: RoleRow[]) {
  const ordered = [...roles].sort((a, b) => a.signingOrder - b.signingOrder);
  return {
    id: packet.id,
    title: packet.title,
    roles: ordered.map((r) => ({
      signing_order: r.signingOrder,
      role_name: r.roleName,
    })),
    created_at: packet.createdAt.toISOString(),
  };
}

async function requireEntitledCabinet(req: Request) {
  const caller = await requireCaller(req);
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

async function loadRoles(db: AuditDb, packetId: string): Promise<RoleRow[]> {
  const roles = await db
    .select()
    .from(packetRoles)
    .where(eq(packetRoles.packetId, packetId));
  roles.sort((a, b) => a.signingOrder - b.signingOrder);
  return roles;
}

async function loadCabinetPacket(
  db: AuditDb,
  cabinet: Cabinet,
  packetId: string,
): Promise<
  | { ok: true; packet: PacketRow; roles: RoleRow[] }
  | { ok: false; response: Response }
> {
  if (!packetId) {
    return { ok: false, response: jsonError(400, "Packet id is required", "invalid_request") };
  }
  const [packet] = await db
    .select()
    .from(packets)
    .where(
      and(eq(packets.id, packetId), eq(packets.ownerUserId, cabinet.ownerUserId)),
    );
  if (!packet) {
    return { ok: false, response: jsonError(404, "Packet not found", "not_found") };
  }
  return { ok: true, packet, roles: await loadRoles(db, packet.id) };
}

function parseRoles(
  raw: unknown,
): { ok: true; names: string[] } | { ok: false; response: Response } {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        response: jsonError(400, "Roles must be a JSON array", "invalid_request"),
      };
    }
  }
  if (!Array.isArray(value) || value.length === 0) {
    return {
      ok: false,
      response: jsonError(400, "At least one role is required", "invalid_request"),
    };
  }
  const names: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return {
        ok: false,
        response: jsonError(400, "Each role needs a role_name", "invalid_request"),
      };
    }
    const name = String(
      (item as { role_name?: unknown }).role_name ?? "",
    ).trim();
    if (!name) {
      return {
        ok: false,
        response: jsonError(400, "Each role needs a role_name", "invalid_request"),
      };
    }
    names.push(name);
  }
  return { ok: true, names };
}

async function insertRoles(db: AuditDb, packetId: string, names: string[]) {
  await db.insert(packetRoles).values(
    names.map((roleName, i) => ({
      packetId,
      signingOrder: i + 1,
      roleName,
    })),
  );
}

export async function listPackets(req: Request): Promise<Response> {
  const gate = await requireEntitledCabinet(req);
  if (!gate.ok) return gate.response;
  const rows = await gate.caller.db
    .select()
    .from(packets)
    .where(eq(packets.ownerUserId, gate.cabinet.ownerUserId));
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (rows.length === 0) return Response.json({ packets: [] });
  const roleRows = await gate.caller.db
    .select()
    .from(packetRoles)
    .where(
      inArray(
        packetRoles.packetId,
        rows.map((r) => r.id),
      ),
    );
  const byPacket = new Map<string, RoleRow[]>();
  for (const role of roleRows) {
    const list = byPacket.get(role.packetId) ?? [];
    list.push(role);
    byPacket.set(role.packetId, list);
  }
  return Response.json({
    packets: rows.map((p) => packetJson(p, byPacket.get(p.id) ?? [])),
  });
}

export async function createPacket(req: Request): Promise<Response> {
  const gate = await requireEntitledCabinet(req);
  if (!gate.ok) return gate.response;
  const store = getDeps().store;
  if (!store) return storeUnavailableResponse();

  const [cap] = await gate.caller.db
    .select({ n: count() })
    .from(packets)
    .where(eq(packets.ownerUserId, gate.cabinet.ownerUserId));
  if (Number(cap?.n ?? 0) >= PACKET_CAP) {
    return jsonError(400, "Packet limit reached", "packet_limit");
  }

  const ct = req.headers.get("content-type") ?? "";
  let title = "";
  let envelopeId = "";
  let rolesRaw: unknown;
  let file: Blob | null = null;

  if (ct.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError(400, "Expected multipart form data", "invalid_request");
    }
    title = String(form.get("title") ?? "").trim();
    envelopeId = String(form.get("envelope_id") ?? "").trim();
    rolesRaw = form.has("roles") ? form.get("roles") : undefined;
    const uploaded = form.get("file");
    file = uploaded instanceof Blob ? uploaded : null;
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
    const json = body as {
      title?: unknown;
      envelope_id?: unknown;
      roles?: unknown;
    };
    title = typeof json.title === "string" ? json.title.trim() : "";
    envelopeId =
      typeof json.envelope_id === "string" ? json.envelope_id.trim() : "";
    rolesRaw = json.roles;
  }

  let bytes: Uint8Array;
  let roleNames: string[];

  if (envelopeId) {
    const [envelope] = await gate.caller.db
      .select()
      .from(envelopes)
      .where(eq(envelopes.id, envelopeId));
    if (
      !envelope ||
      envelope.status === "deleted" ||
      !envelope.userId ||
      !gate.cabinet.memberUserIds.includes(envelope.userId)
    ) {
      return jsonError(404, "Envelope not found", "not_found");
    }
    const [doc] = await gate.caller.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.envelopeId, envelopeId),
          eq(documents.kind, "original"),
        ),
      );
    const path = doc?.storagePath ?? objectKey(envelopeId, "original");
    const copied = await store.get(path);
    if (!copied) return jsonError(404, "Envelope not found", "not_found");
    bytes = copied;
    if (!title) title = envelope.title;
    if (rolesRaw !== undefined) {
      const parsed = parseRoles(rolesRaw);
      if (!parsed.ok) return parsed.response;
      roleNames = parsed.names;
    } else {
      const signerRows = await gate.caller.db
        .select()
        .from(signersTable)
        .where(eq(signersTable.envelopeId, envelopeId));
      signerRows.sort((a, b) => a.signingOrder - b.signingOrder);
      roleNames = signerRows.map((s) => s.name.trim()).filter(Boolean);
      if (roleNames.length === 0) {
        return jsonError(400, "At least one role is required", "invalid_request");
      }
    }
  } else {
    if (!(file instanceof Blob)) {
      return jsonError(400, "A PDF file is required", "invalid_pdf");
    }
    if (file.size > PDF_MAX_BYTES) {
      return jsonError(400, "PDF exceeds maximum size", "invalid_pdf");
    }
    bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPdf(bytes, file.type)) {
      return jsonError(400, "File must be a PDF", "invalid_pdf");
    }
    const parsed = parseRoles(rolesRaw);
    if (!parsed.ok) return parsed.response;
    roleNames = parsed.names;
  }

  if (!title) return jsonError(400, "Title is required", "invalid_request");

  const id = randomUUID();
  const storagePath = packetObjectKey(id);
  await store.put(storagePath, bytes);
  const [packet] = await gate.caller.db
    .insert(packets)
    .values({
      id,
      ownerUserId: gate.cabinet.ownerUserId,
      createdByUserId: gate.caller.user.id,
      title,
      storagePath,
    })
    .returning();
  await insertRoles(gate.caller.db, packet.id, roleNames);
  return Response.json(packetJson(packet, await loadRoles(gate.caller.db, packet.id)), {
    status: 201,
  });
}

export async function getPacket(req: Request, packetId: string): Promise<Response> {
  const gate = await requireEntitledCabinet(req);
  if (!gate.ok) return gate.response;
  const loaded = await loadCabinetPacket(gate.caller.db, gate.cabinet, packetId);
  if (!loaded.ok) return loaded.response;
  return Response.json(packetJson(loaded.packet, loaded.roles));
}

export async function patchPacket(
  req: Request,
  packetId: string,
): Promise<Response> {
  const gate = await requireEntitledCabinet(req);
  if (!gate.ok) return gate.response;
  const loaded = await loadCabinetPacket(gate.caller.db, gate.cabinet, packetId);
  if (!loaded.ok) return loaded.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  const json = body as { title?: unknown; roles?: unknown };

  if ("title" in json) {
    if (typeof json.title !== "string" || !json.title.trim()) {
      return jsonError(400, "Title is required", "invalid_request");
    }
    await gate.caller.db
      .update(packets)
      .set({ title: json.title.trim() })
      .where(eq(packets.id, loaded.packet.id));
  }
  if ("roles" in json) {
    const parsed = parseRoles(json.roles);
    if (!parsed.ok) return parsed.response;
    await gate.caller.db
      .delete(packetRoles)
      .where(eq(packetRoles.packetId, loaded.packet.id));
    await insertRoles(gate.caller.db, loaded.packet.id, parsed.names);
  }

  const [updated] = await gate.caller.db
    .select()
    .from(packets)
    .where(eq(packets.id, loaded.packet.id));
  return Response.json(
    packetJson(updated ?? loaded.packet, await loadRoles(gate.caller.db, loaded.packet.id)),
  );
}

export async function deletePacket(
  req: Request,
  packetId: string,
): Promise<Response> {
  const gate = await requireEntitledCabinet(req);
  if (!gate.ok) return gate.response;
  const loaded = await loadCabinetPacket(gate.caller.db, gate.cabinet, packetId);
  if (!loaded.ok) return loaded.response;
  const store = getDeps().store;
  if (!store) return storeUnavailableResponse();
  await store.delete(loaded.packet.storagePath);
  await gate.caller.db
    .delete(packetRoles)
    .where(eq(packetRoles.packetId, loaded.packet.id));
  await gate.caller.db.delete(packets).where(eq(packets.id, loaded.packet.id));
  return new Response(null, { status: 204 });
}

export async function sendPacket(
  req: Request,
  packetId: string,
): Promise<Response> {
  const gate = await requireEntitledCabinet(req);
  if (!gate.ok) return gate.response;
  const loaded = await loadCabinetPacket(gate.caller.db, gate.cabinet, packetId);
  if (!loaded.ok) return loaded.response;
  const store = getDeps().store;
  if (!store) return storeUnavailableResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  const signers = (body as { signers?: unknown }).signers;
  if (!Array.isArray(signers) || signers.length !== loaded.roles.length) {
    return jsonError(
      400,
      "Signer count must match packet roles",
      "invalid_request",
    );
  }
  const parsed: { name: string; email: string }[] = [];
  for (const item of signers) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return jsonError(400, "Each signer needs name and email", "invalid_request");
    }
    const name = String((item as { name?: unknown }).name ?? "").trim();
    const email = String((item as { email?: unknown }).email ?? "")
      .trim()
      .toLowerCase();
    if (!name || !email) {
      return jsonError(400, "Each signer needs name and email", "invalid_request");
    }
    parsed.push({ name, email });
  }

  const bytes = await store.get(loaded.packet.storagePath);
  if (!bytes) return jsonError(404, "Packet not found", "not_found");

  const form = new FormData();
  form.set("title", loaded.packet.title);
  form.set("sender_email", gate.caller.user.email);
  form.set("signers", JSON.stringify(parsed));
  form.set("file", new Blob([bytes], { type: "application/pdf" }), "packet.pdf");

  const headers = new Headers();
  const authorization = req.headers.get("authorization");
  const cookie = req.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);

  return createEnvelope(
    new Request("http://sign.local/v1/envelopes", {
      method: "POST",
      headers,
      body: form,
    }),
  );
}
