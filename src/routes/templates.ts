import { randomUUID } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import {
  accounts,
  files,
  documents,
  templateRoles,
  templates,
  signers as signersTable,
} from "../db/schema.js";
import type { AuditDb } from "../lib/audit.js";
import { teamForUser, type Team } from "../lib/team.js";
import { requireCaller } from "../lib/caller.js";
import { getDeps, storeUnavailableResponse } from "../lib/deps.js";
import { TEMPLATE_CAP } from "../lib/entitlement.js";
import {
  defaultRoleName,
  mergeFields,
  parseFieldsJson,
  type DocumentField,
} from "../lib/pdf/fields.js";
import { objectKey } from "../lib/storage.js";
import {
  normalizeUploadToPdf,
  parseDocumentExtras,
  parsePdfAndFields,
  sendPreparedPdf,
} from "./documents.js";

type TemplateRow = typeof templates.$inferSelect;
type RoleRow = typeof templateRoles.$inferSelect;

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function templateObjectKey(id: string): string {
  return `templates/${id}/original.pdf`;
}

function templateJson(template: TemplateRow, roles: RoleRow[]) {
  const ordered = [...roles].sort((a, b) => a.signingOrder - b.signingOrder);
  return {
    id: template.id,
    title: template.title,
    roles: ordered.map((r) => ({
      signing_order: r.signingOrder,
      role_name: r.roleName,
    })),
    fields: template.fields ?? [],
    created_at: template.createdAt.toISOString(),
  };
}

function uniqueRoleNames(roleNames: string[]): Response | null {
  if (new Set(roleNames).size !== roleNames.length) {
    return jsonError(400, "Role names must be unique", "invalid_request");
  }
  return null;
}

function fieldsMatchRoles(
  fields: DocumentField[],
  roleNames: string[],
): Response | null {
  const uniqueErr = uniqueRoleNames(roleNames);
  if (uniqueErr) return uniqueErr;
  const roles = new Set(roleNames);
  for (const field of fields) {
    if (!roles.has(field.role)) {
      return jsonError(400, "Field role does not match a template role", "invalid_fields");
    }
  }
  return null;
}

function parseTemplateFieldsJson(
  raw: unknown,
): { ok: true; fields: DocumentField[] } | { ok: false; response: Response } {
  if (raw == null || raw === "") return { ok: true, fields: [] };
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        response: jsonError(400, "Invalid fields", "invalid_fields"),
      };
    }
  }
  const parsed = parseFieldsJson(value);
  if (!parsed.ok) {
    return {
      ok: false,
      response: jsonError(400, parsed.error, parsed.code),
    };
  }
  return { ok: true, fields: parsed.fields };
}

async function requireEntitledTeam(req: Request) {
  const caller = await requireCaller(req);
  if (!caller.ok) return caller;
  const team = await teamForUser(caller.db, caller.user.id);
  if (!team.entitled) {
    return {
      ok: false as const,
      response: jsonError(403, "Pro plan required", "pro_required"),
    };
  }
  return { ok: true as const, caller, team };
}

async function loadRoles(db: AuditDb, templateId: string): Promise<RoleRow[]> {
  const roles = await db
    .select()
    .from(templateRoles)
    .where(eq(templateRoles.templateId, templateId));
  roles.sort((a, b) => a.signingOrder - b.signingOrder);
  return roles;
}

async function loadTeamTemplate(
  db: AuditDb,
  team: Team,
  templateId: string,
): Promise<
  | { ok: true; template: TemplateRow; roles: RoleRow[] }
  | { ok: false; response: Response }
> {
  if (!templateId) {
    return { ok: false, response: jsonError(400, "Template id is required", "invalid_request") };
  }
  const [template] = await db
    .select()
    .from(templates)
    .where(
      and(eq(templates.id, templateId), eq(templates.ownerUserId, team.ownerUserId)),
    );
  if (!template) {
    return { ok: false, response: jsonError(404, "Template not found", "not_found") };
  }
  return { ok: true, template, roles: await loadRoles(db, template.id) };
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

async function insertRoles(db: AuditDb, templateId: string, names: string[]) {
  await db.insert(templateRoles).values(
    names.map((roleName, i) => ({
      templateId,
      signingOrder: i + 1,
      roleName,
    })),
  );
}

export async function listTemplates(req: Request): Promise<Response> {
  const gate = await requireEntitledTeam(req);
  if (!gate.ok) return gate.response;
  const rows = await gate.caller.db
    .select()
    .from(templates)
    .where(eq(templates.ownerUserId, gate.team.ownerUserId));
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (rows.length === 0) return Response.json({ templates: [] });
  const roleRows = await gate.caller.db
    .select()
    .from(templateRoles)
    .where(
      inArray(
        templateRoles.templateId,
        rows.map((r) => r.id),
      ),
    );
  const byTemplate = new Map<string, RoleRow[]>();
  for (const role of roleRows) {
    const list = byTemplate.get(role.templateId) ?? [];
    list.push(role);
    byTemplate.set(role.templateId, list);
  }
  return Response.json({
    templates: rows.map((p) => templateJson(p, byTemplate.get(p.id) ?? [])),
  });
}

export async function createTemplate(req: Request): Promise<Response> {
  const gate = await requireEntitledTeam(req);
  if (!gate.ok) return gate.response;
  const store = getDeps().store;
  if (!store) return storeUnavailableResponse();

  const [cap] = await gate.caller.db
    .select({ n: count() })
    .from(templates)
    .where(eq(templates.ownerUserId, gate.team.ownerUserId));
  if (Number(cap?.n ?? 0) >= TEMPLATE_CAP) {
    return jsonError(400, "Template limit reached", "template_limit");
  }

  const ct = req.headers.get("content-type") ?? "";
  let title = "";
  let documentId = "";
  let rolesRaw: unknown;
  let fieldsRaw: unknown;
  let file: Blob | null = null;

  if (ct.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError(400, "Expected multipart form data", "invalid_request");
    }
    title = String(form.get("title") ?? "").trim();
    documentId = String(form.get("document_id") ?? "").trim();
    rolesRaw = form.has("roles") ? form.get("roles") : undefined;
    fieldsRaw = form.has("fields") ? form.get("fields") : undefined;
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
      document_id?: unknown;
      roles?: unknown;
      fields?: unknown;
    };
    title = typeof json.title === "string" ? json.title.trim() : "";
    documentId =
      typeof json.document_id === "string" ? json.document_id.trim() : "";
    rolesRaw = json.roles;
    fieldsRaw = json.fields;
  }

  let bytes: Uint8Array;
  let roleNames: string[];
  let fields: DocumentField[] = [];

  if (documentId) {
    const [document] = await gate.caller.db
      .select()
      .from(documents)
      .where(eq(documents.id, documentId));
    if (
      !document ||
      document.status === "deleted" ||
      !document.userId ||
      !gate.team.memberUserIds.includes(document.userId)
    ) {
      return jsonError(404, "Document not found", "not_found");
    }
    const [doc] = await gate.caller.db
      .select()
      .from(files)
      .where(
        and(
          eq(files.documentId, documentId),
          eq(files.kind, "original"),
        ),
      );
    const path = doc?.storagePath ?? objectKey(documentId, "original");
    const copied = await store.get(path);
    if (!copied) return jsonError(404, "Document not found", "not_found");
    bytes = copied;
    if (!title) title = document.title;
    if (rolesRaw !== undefined) {
      const parsed = parseRoles(rolesRaw);
      if (!parsed.ok) return parsed.response;
      roleNames = parsed.names;
    } else {
      const signerRows = await gate.caller.db
        .select()
        .from(signersTable)
        .where(eq(signersTable.documentId, documentId));
      signerRows.sort((a, b) => a.signingOrder - b.signingOrder);
      roleNames = signerRows
        .map((s) => (s.roleName || defaultRoleName(s.signingOrder)).trim())
        .filter(Boolean);
      if (roleNames.length === 0) {
        return jsonError(400, "At least one role is required", "invalid_request");
      }
    }
    const extra = parseTemplateFieldsJson(fieldsRaw);
    if (!extra.ok) return extra.response;
    const merged = mergeFields(document.fields ?? [], extra.fields);
    if (!merged.ok) return jsonError(400, merged.error, merged.code);
    fields = merged.fields;
  } else {
    if (!(file instanceof Blob)) {
      return jsonError(400, "A PDF file is required", "invalid_pdf");
    }
    const normalized = await normalizeUploadToPdf(file, gate.caller.user.id);
    if (!normalized.ok) return normalized.response;
    bytes = normalized.bytes;
    const parsed = parseRoles(rolesRaw);
    if (!parsed.ok) return parsed.response;
    roleNames = parsed.names;
    // AcroForm fields bind to the template's first role.
    const tagged = await parsePdfAndFields(bytes, fieldsRaw, roleNames[0] ?? null);
    if (!tagged.ok) return tagged.response;
    bytes = tagged.storedBytes;
    fields = tagged.fields;
  }

  if (!title) return jsonError(400, "Title is required", "invalid_request");
  const roleErr = fieldsMatchRoles(fields, roleNames);
  if (roleErr) return roleErr;

  const id = randomUUID();
  const storagePath = templateObjectKey(id);
  await store.put(storagePath, bytes);
  const [template] = await gate.caller.db
    .insert(templates)
    .values({
      id,
      ownerUserId: gate.team.ownerUserId,
      createdByUserId: gate.caller.user.id,
      title,
      storagePath,
      fields,
    })
    .returning();
  await insertRoles(gate.caller.db, template.id, roleNames);
  return Response.json(templateJson(template, await loadRoles(gate.caller.db, template.id)), {
    status: 201,
  });
}

export async function getTemplate(req: Request, templateId: string): Promise<Response> {
  const gate = await requireEntitledTeam(req);
  if (!gate.ok) return gate.response;
  const loaded = await loadTeamTemplate(gate.caller.db, gate.team, templateId);
  if (!loaded.ok) return loaded.response;
  return Response.json(templateJson(loaded.template, loaded.roles));
}

export async function patchTemplate(
  req: Request,
  templateId: string,
): Promise<Response> {
  const gate = await requireEntitledTeam(req);
  if (!gate.ok) return gate.response;
  const loaded = await loadTeamTemplate(gate.caller.db, gate.team, templateId);
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
  const json = body as { title?: unknown; roles?: unknown; fields?: unknown };

  let title = loaded.template.title;
  let roleNames = loaded.roles.map((r) => r.roleName);
  let fields = loaded.template.fields ?? [];

  if ("title" in json) {
    if (typeof json.title !== "string" || !json.title.trim()) {
      return jsonError(400, "Title is required", "invalid_request");
    }
    title = json.title.trim();
  }
  if ("roles" in json) {
    const parsed = parseRoles(json.roles);
    if (!parsed.ok) return parsed.response;
    roleNames = parsed.names;
  }
  if ("fields" in json) {
    const parsed = parseTemplateFieldsJson(json.fields);
    if (!parsed.ok) return parsed.response;
    fields = parsed.fields;
  }
  const roleErr = fieldsMatchRoles(fields, roleNames);
  if (roleErr) return roleErr;

  if ("title" in json || "fields" in json) {
    await gate.caller.db
      .update(templates)
      .set({
        ...("title" in json ? { title } : {}),
        ...("fields" in json ? { fields } : {}),
      })
      .where(eq(templates.id, loaded.template.id));
  }
  if ("roles" in json) {
    await gate.caller.db
      .delete(templateRoles)
      .where(eq(templateRoles.templateId, loaded.template.id));
    await insertRoles(gate.caller.db, loaded.template.id, roleNames);
  }

  const [updated] = await gate.caller.db
    .select()
    .from(templates)
    .where(eq(templates.id, loaded.template.id));
  return Response.json(
    templateJson(updated ?? loaded.template, await loadRoles(gate.caller.db, loaded.template.id)),
  );
}

export async function deleteTemplate(
  req: Request,
  templateId: string,
): Promise<Response> {
  const gate = await requireEntitledTeam(req);
  if (!gate.ok) return gate.response;
  const loaded = await loadTeamTemplate(gate.caller.db, gate.team, templateId);
  if (!loaded.ok) return loaded.response;
  const store = getDeps().store;
  if (!store) return storeUnavailableResponse();
  await store.delete(loaded.template.storagePath);
  await gate.caller.db
    .delete(templateRoles)
    .where(eq(templateRoles.templateId, loaded.template.id));
  await gate.caller.db.delete(templates).where(eq(templates.id, loaded.template.id));
  return new Response(null, { status: 204 });
}

export async function sendTemplate(
  req: Request,
  templateId: string,
): Promise<Response> {
  const gate = await requireEntitledTeam(req);
  if (!gate.ok) return gate.response;
  const loaded = await loadTeamTemplate(gate.caller.db, gate.team, templateId);
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
      "Signer count must match template roles",
      "invalid_request",
    );
  }
  const parsed: { name: string; email: string; role: string; values?: Record<string, string | boolean> }[] = [];
  for (let i = 0; i < signers.length; i++) {
    const item = signers[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return jsonError(400, "Each signer needs name and email", "invalid_request");
    }
    const row = item as {
      name?: unknown;
      email?: unknown;
      role?: unknown;
      values?: unknown;
    };
    const name = String(row.name ?? "").trim();
    const email = String(row.email ?? "")
      .trim()
      .toLowerCase();
    if (!name || !email) {
      return jsonError(400, "Each signer needs name and email", "invalid_request");
    }
    const slotRole = loaded.roles[i]!.roleName;
    const role =
      row.role == null || row.role === ""
        ? slotRole
        : String(row.role).trim();
    if (role !== slotRole) {
      return jsonError(
        400,
        "Signer role must match the template role",
        "invalid_fields",
      );
    }
    const values = parseTemplateSignerValues(row.values);
    if (!values.ok) return values.response;
    parsed.push({ name, email, role, values: values.values });
  }

  const extras = await parseDocumentExtras({
    valuesRaw: (body as { values?: unknown }).values,
    order: (body as { order?: unknown }).order,
    sendEmail: (body as { send_email?: unknown }).send_email,
    completedRedirectUrl: (body as { completed_redirect_url?: unknown })
      .completed_redirect_url,
    embedOrigin: (body as { embed_origin?: unknown }).embed_origin,
  });
  if (!extras.ok) return extras.response;

  const bytes = await store.get(loaded.template.storagePath);
  if (!bytes) return jsonError(404, "Template not found", "not_found");

  // Same rule as direct sends: OAuth-connected agents hold for the owner's
  // emailed confirmation unless it's turned off; sessions and API keys send.
  let holdForConfirmation = false;
  if (gate.caller.via === "oauth") {
    const [acct] = await gate.caller.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, gate.caller.user.id));
    holdForConfirmation = acct?.confirmAgentSends ?? true;
  }

  return sendPreparedPdf({
    title: loaded.template.title,
    senderEmail: gate.caller.user.email,
    userId: gate.caller.user.id,
    signers: parsed,
    bytes,
    fields: loaded.template.fields ?? [],
    values: extras.extras.docValues,
    signingMode: extras.extras.signingMode,
    sendEmail: extras.extras.sendEmail,
    completedRedirectUrl: extras.extras.completedRedirectUrl,
    embedOrigin: extras.extras.embedOrigin,
    holdForConfirmation,
  });
}

function parseTemplateSignerValues(
  raw: unknown,
):
  | { ok: true; values: Record<string, string | boolean> | undefined }
  | { ok: false; response: Response } {
  if (raw == null) return { ok: true, values: undefined };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      response: jsonError(400, "Invalid values", "invalid_values"),
    };
  }
  const values: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string" && typeof v !== "boolean") {
      return {
        ok: false,
        response: jsonError(400, "Invalid values", "invalid_values"),
      };
    }
    values[k] = v;
  }
  return { ok: true, values };
}
