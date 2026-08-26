import { and, count, eq, gte, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import {
  accounts,
  agents,
  apiKeys,
  auditEvents,
  files,
  documents,
  otpChallenges,
  signers as signersTable,
} from "../db/schema.js";
import { loadActiveAgentBySlug, parseAgentSlug } from "../lib/agents.js";
import { logEvent, type AuditDb } from "../lib/audit.js";
import type { AuthUser } from "../lib/auth/supabase.js";
import { getAuth } from "../lib/auth/supabase.js";
import { teamForUser } from "../lib/team.js";
import { getDeps, storeUnavailableResponse } from "../lib/deps.js";
import { flagOn } from "../lib/flags.js";
import { loadBrand } from "../lib/branding.js";
import { publicSignUrl } from "../lib/signing-url.js";
import {
  brandMailAttachments,
  createMailer,
  inviteEmail,
  otpEmail,
  type Mailer,
} from "../lib/email.js";
import { sha256Hex } from "../lib/hash.js";
import {
  claimSends,
  ensureAccount,
  lookupApiKey,
} from "../lib/keys.js";
import { accountForOauthGrant, lookupOauthGrant } from "../lib/oauth.js";
import { newOtp } from "../lib/otp.js";
import { parseEmbedOrigin } from "../lib/embed.js";
import {
  defaultRoleName,
  mergeFields,
  parseFieldsJson,
  type DocumentField,
} from "../lib/pdf/fields.js";
import { InvalidFieldsError, parsePdfTags } from "../lib/pdf/tags.js";
import {
  appearanceKey,
  fieldAppearanceKey,
  objectKey,
  type BlobStore,
} from "../lib/storage.js";
import { newSigningToken, placeholderSigningTokenHash } from "../lib/tokens.js";
import {
  fireAgentPartyReady,
  newWebhookSecret,
  openWebhookSecret,
  sealWebhookSecret,
  webhookEncryptionReady,
  webhookUrlError,
} from "../lib/webhooks.js";
import { getEnv } from "../env.js";
import { purgeDocument } from "../jobs/shred.js";

const PDF_MAX_BYTES = 20 * 1024 * 1024;
const OTP_TTL_MS = 10 * 60 * 1000;

const signerSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  kind: z.enum(["human", "agent"]).optional(),
  agent: z.string().optional(),
  role: z.string().max(80).optional(),
  values: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});
const signersSchema = z.array(signerSchema).min(1);

type ParsedSigner = z.infer<typeof signerSchema>;
type FieldValues = Record<string, string | boolean>;
type ResolvedParty = {
  name: string;
  email: string;
  kind: "human" | "agent";
  agentId: string | null;
};
type PreparedSigner = ResolvedParty & {
  roleName: string;
  values: FieldValues;
};

type InviteSigner = { email: string; role: string; sign_url: string };

type DocumentExtras = {
  fields: DocumentField[];
  signingMode: "sequential" | "parallel";
  sendEmail: boolean;
  completedRedirectUrl: string | null;
  embedOrigin: string | null;
  docValues: FieldValues;
};

async function resolveSignerParties(
  db: AuditDb,
  parsed: ParsedSigner[],
  userId: string | null,
): Promise<
  { ok: true; parties: ResolvedParty[] } | { ok: false; response: Response }
> {
  const wantsAgent = parsed.some((s) => (s.kind ?? "human") === "agent");
  if (!wantsAgent) {
    return {
      ok: true,
      parties: parsed.map((s) => ({
        name: s.name,
        email: s.email.trim().toLowerCase(),
        kind: "human" as const,
        agentId: null,
      })),
    };
  }

  if (!(await flagOn("agent_parties"))) {
    return {
      ok: false,
      response: jsonError(403, "Agent parties are disabled", "flag_off"),
    };
  }
  if (!userId) {
    return {
      ok: false,
      response: jsonError(403, "Pro plan required", "pro_required"),
    };
  }

  const team = await teamForUser(db, userId);
  if (!team.entitled) {
    return {
      ok: false,
      response: jsonError(403, "Pro plan required", "pro_required"),
    };
  }

  const ownerEmail = team.ownerEmail?.trim().toLowerCase() ?? "";
  const parties: ResolvedParty[] = [];
  for (const s of parsed) {
    const kind = s.kind ?? "human";
    const email = s.email.trim().toLowerCase();
    if (kind !== "agent") {
      parties.push({ name: s.name, email, kind: "human", agentId: null });
      continue;
    }
    const slug = parseAgentSlug(s.agent);
    if (!slug) {
      return { ok: false, response: jsonError(400, "Unknown agent", "unknown_agent") };
    }
    const agent = await loadActiveAgentBySlug(db, team.ownerUserId, slug);
    if (!agent) {
      return { ok: false, response: jsonError(400, "Unknown agent", "unknown_agent") };
    }
    if (!ownerEmail || email !== ownerEmail) {
      return {
        ok: false,
        response: jsonError(
          400,
          "Agent party email must match the agent owner's account",
          "invalid_request",
        ),
      };
    }
    parties.push({ name: s.name, email, kind: "agent", agentId: agent.id });
  }
  return { ok: true, parties };
}

function signerInsertValues(documentId: string, parties: PreparedSigner[]) {
  return parties.map((s, i) => ({
    documentId,
    name: s.name,
    email: s.email,
    signingOrder: i + 1,
    kind: s.kind,
    agentId: s.agentId,
    tokenHash: s.kind === "agent" ? null : placeholderSigningTokenHash(),
    roleName: s.roleName,
    values: s.values,
  }));
}

function agentFieldForbidden(field: DocumentField): boolean {
  if (
    field.type === "signature" ||
    field.type === "initials" ||
    field.type === "checkbox"
  ) {
    return true;
  }
  if (
    field.readonly &&
    (field.type === "date" || field.type === "name" || field.type === "text")
  ) {
    return false;
  }
  return true;
}

function parseJsonValue(
  raw: unknown,
): { ok: true; value: unknown } | { ok: false; response: Response } {
  if (raw == null || raw === "") return { ok: true, value: undefined };
  if (typeof raw !== "string") return { ok: true, value: raw };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return {
      ok: false,
      response: jsonError(400, "Invalid JSON", "invalid_request"),
    };
  }
}

function parseValuesObject(
  raw: unknown,
  code: "invalid_values" | "invalid_request" = "invalid_values",
): { ok: true; values: FieldValues } | { ok: false; response: Response } {
  if (raw == null || raw === "") return { ok: true, values: {} };
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, response: jsonError(400, "Invalid values", code) };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, response: jsonError(400, "Invalid values", code) };
  }
  const values: FieldValues = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "string" && typeof v !== "boolean") {
      return { ok: false, response: jsonError(400, "Invalid values", code) };
    }
    values[k] = v;
  }
  return { ok: true, values };
}

function parseSendEmail(
  raw: unknown,
): { ok: true; value: boolean } | { ok: false; response: Response } {
  if (raw == null || raw === "") return { ok: true, value: true };
  if (raw === true || raw === "true") return { ok: true, value: true };
  if (raw === false || raw === "false") return { ok: true, value: false };
  return {
    ok: false,
    response: jsonError(400, "send_email must be true or false", "invalid_request"),
  };
}

function parseSigningMode(
  raw: unknown,
):
  | { ok: true; value: "sequential" | "parallel" }
  | { ok: false; response: Response } {
  if (raw == null || raw === "") return { ok: true, value: "sequential" };
  if (raw === "sequential" || raw === "parallel") {
    return { ok: true, value: raw };
  }
  return {
    ok: false,
    response: jsonError(400, "order must be sequential or parallel", "invalid_request"),
  };
}

async function parseCompletedRedirectUrl(
  raw: unknown,
): Promise<{ ok: true; url: string | null } | { ok: false; response: Response }> {
  if (raw == null || raw === "") return { ok: true, url: null };
  if (typeof raw !== "string") {
    return {
      ok: false,
      response: jsonError(400, "Invalid completed_redirect_url", "invalid_request"),
    };
  }
  const url = raw.trim();
  if (!url) return { ok: true, url: null };
  if (url.length > 2048) {
    return {
      ok: false,
      response: jsonError(400, "completed_redirect_url is too long", "invalid_request"),
    };
  }
  const blocked = await webhookUrlError(url);
  if (blocked) {
    return { ok: false, response: jsonError(400, blocked, "invalid_request") };
  }
  return { ok: true, url };
}

function parseOriginField(
  raw: unknown,
): { ok: true; origin: string | null } | { ok: false; response: Response } {
  if (raw == null || raw === "") return { ok: true, origin: null };
  if (typeof raw !== "string") {
    return {
      ok: false,
      response: jsonError(400, "Invalid embed origin", "embed_origin_invalid"),
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, origin: null };
  const parsed = parseEmbedOrigin(trimmed);
  if (!parsed.ok) {
    return {
      ok: false,
      response: jsonError(400, "Invalid embed origin", "embed_origin_invalid"),
    };
  }
  return { ok: true, origin: parsed.origin };
}

export async function parsePdfAndFields(
  bytes: Uint8Array,
  fieldsRaw: unknown,
): Promise<
  | { ok: true; fields: DocumentField[]; storedBytes: Uint8Array }
  | { ok: false; response: Response }
> {
  let tagFields: DocumentField[] = [];
  let storedBytes = bytes;
  try {
    const parsed = await parsePdfTags(bytes);
    tagFields = parsed.fields;
    storedBytes = parsed.pdf;
  } catch (err) {
    if (err instanceof InvalidFieldsError) {
      return {
        ok: false,
        response: jsonError(400, err.message, "invalid_fields"),
      };
    }
    return {
      ok: false,
      response: jsonError(400, "File must be a PDF", "invalid_pdf"),
    };
  }

  let extra: DocumentField[] = [];
  if (fieldsRaw != null && fieldsRaw !== "") {
    const json = parseJsonValue(fieldsRaw);
    if (!json.ok) {
      return {
        ok: false,
        response: jsonError(400, "Invalid fields", "invalid_fields"),
      };
    }
    if (json.value !== undefined) {
      const parsed = parseFieldsJson(json.value);
      if (!parsed.ok) {
        return {
          ok: false,
          response: jsonError(400, parsed.error, parsed.code),
        };
      }
      extra = parsed.fields;
    }
  }

  const merged = mergeFields(tagFields, extra);
  if (!merged.ok) {
    return {
      ok: false,
      response: jsonError(400, merged.error, merged.code),
    };
  }
  return { ok: true, fields: merged.fields, storedBytes };
}

export async function parseDocumentExtras(input: {
  valuesRaw?: unknown;
  order?: unknown;
  sendEmail?: unknown;
  completedRedirectUrl?: unknown;
  embedOrigin?: unknown;
}): Promise<{ ok: true; extras: Omit<DocumentExtras, "fields"> } | { ok: false; response: Response }> {
  const values = parseValuesObject(input.valuesRaw);
  if (!values.ok) return values;
  const order = parseSigningMode(input.order);
  if (!order.ok) return order;
  const sendEmail = parseSendEmail(input.sendEmail);
  if (!sendEmail.ok) return sendEmail;
  const redirect = await parseCompletedRedirectUrl(input.completedRedirectUrl);
  if (!redirect.ok) return redirect;
  const origin = parseOriginField(input.embedOrigin);
  if (!origin.ok) return origin;
  return {
    ok: true,
    extras: {
      signingMode: order.value,
      sendEmail: sendEmail.value,
      completedRedirectUrl: redirect.url,
      embedOrigin: origin.origin,
      docValues: values.values,
    },
  };
}

function prepareParties(
  parties: ResolvedParty[],
  parsedSigners: ParsedSigner[],
  fields: DocumentField[],
  docValues: FieldValues,
): { ok: true; prepared: PreparedSigner[] } | { ok: false; response: Response } {
  const prepared: PreparedSigner[] = parties.map((p, i) => {
    const given = parsedSigners[i]?.role?.trim() ?? "";
    return {
      ...p,
      roleName: given || defaultRoleName(i + 1),
      values: {},
    };
  });

  if (fields.length > 0 && !prepared.some((p) => p.kind === "human")) {
    return {
      ok: false,
      response: jsonError(400, "Fields require a human party", "invalid_fields"),
    };
  }

  const roles = new Set(prepared.map((p) => p.roleName));
  for (const field of fields) {
    if (!roles.has(field.role)) {
      return {
        ok: false,
        response: jsonError(400, "Field role does not match a signer", "invalid_fields"),
      };
    }
    const owners = prepared.filter((p) => p.roleName === field.role);
    if (owners.some((o) => o.kind === "agent") && agentFieldForbidden(field)) {
      return {
        ok: false,
        response: jsonError(
          400,
          "Interactive fields cannot be assigned to an agent",
          "invalid_fields",
        ),
      };
    }
  }

  for (let i = 0; i < prepared.length; i++) {
    const party = prepared[i]!;
    const signerValues = parsedSigners[i]?.values ?? {};
    const values: FieldValues = {};
    for (const field of fields) {
      if (field.role !== party.roleName) continue;
      if (field.default_value !== undefined) values[field.name] = field.default_value;
      if (docValues[field.name] !== undefined) values[field.name] = docValues[field.name]!;
      if (signerValues[field.name] !== undefined) {
        values[field.name] = signerValues[field.name]!;
      }
      if (field.readonly && values[field.name] === undefined) {
        return {
          ok: false,
          response: jsonError(400, "Readonly field is missing a value", "invalid_values"),
        };
      }
    }
    party.values = values;
  }

  return { ok: true, prepared };
}

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
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

function requireDb(): AuditDb {
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

function hasApiKeyQuery(req: Request): boolean {
  return new URL(req.url).searchParams.has("apiKey");
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export async function mintHumanTokens(
  db: AuditDb,
  humans: { id: string; tokenEnc: string | null }[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const human of humans) {
    if (human.tokenEnc) {
      map.set(human.id, openWebhookSecret(human.tokenEnc));
      continue;
    }
    const token = newSigningToken();
    await db
      .update(signersTable)
      .set({ tokenHash: token.hash, tokenEnc: sealWebhookSecret(token.raw) })
      .where(eq(signersTable.id, human.id));
    map.set(human.id, token.raw);
  }
  return map;
}

export async function inviteFirstSigner(
  db: AuditDb,
  mailer: Mailer,
  document: {
    id: string;
    senderEmail: string;
    title: string;
    expiresAt: Date;
    userId: string | null;
  },
  at: Date,
): Promise<{ signers: InviteSigner[] }> {
  const signerRows = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.documentId, document.id));
  signerRows.sort((a, b) => a.signingOrder - b.signingOrder);
  const humans = signerRows.filter((s) => s.kind !== "agent");
  const tokens = await mintHumanTokens(db, humans);
  const signers: InviteSigner[] = humans.map((h) => ({
    email: h.email,
    role: h.roleName || defaultRoleName(h.signingOrder),
    sign_url: `/s/${tokens.get(h.id)}`,
  }));

  const first = signerRows[0];
  if (!first) return { signers };
  if (first.kind === "agent") {
    await fireAgentPartyReady(db, { id: document.id, status: "pending" }, first);
    return { signers };
  }
  const raw = tokens.get(first.id);
  if (!raw) return { signers };
  const brand = await loadBrand(db, document.userId, requireStore());
  try {
    await mailer.sendMail({
      to: first.email,
      ...inviteEmail({
        signUrl: publicSignUrl(raw),
        senderEmail: document.senderEmail,
        title: document.title,
        expiresAt: document.expiresAt,
        brand: {
          displayName: brand.displayName,
          hasLogo: Boolean(brand.logoBytes),
        },
      }),
      attachments: brandMailAttachments(brand.logoBytes),
    });
    await db
      .update(signersTable)
      .set({ sentAt: at })
      .where(eq(signersTable.id, first.id));
    await logEvent(db, {
      documentId: document.id,
      signerId: first.id,
      event: "sent",
    });
    await logEvent(db, {
      documentId: document.id,
      signerId: first.id,
      event: "emailed",
    });
  } catch (err) {
    await logEvent(db, {
      documentId: document.id,
      signerId: first.id,
      event: "emailed_failed",
      payload: { error: err instanceof Error ? err.message : "mail_failed" },
    });
  }
  return { signers };
}

export async function sendPreparedPdf(opts: {
  title: string;
  senderEmail: string;
  userId: string;
  signers: ParsedSigner[];
  bytes: Uint8Array;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  fields?: DocumentField[];
  values?: FieldValues;
  signingMode?: "sequential" | "parallel";
  sendEmail?: boolean;
  completedRedirectUrl?: string | null;
  embedOrigin?: string | null;
}): Promise<Response> {
  const db = requireDb();
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const mailer = requireMailer();
  const at = now();
  const env = getEnv();
  const senderEmail = opts.senderEmail.trim().toLowerCase();
  const limit = Number(env.FREE_SEND_LIMIT);
  const windowDays = Number(env.FREE_SEND_WINDOW_DAYS);
  const windowStart = new Date(at.getTime() - windowDays * 86_400_000);

  const resolved = await resolveSignerParties(db, opts.signers, opts.userId);
  if (!resolved.ok) return resolved.response;
  const prepared = prepareParties(
    resolved.parties,
    opts.signers,
    opts.fields ?? [],
    opts.values ?? {},
  );
  if (!prepared.ok) return prepared.response;

  const team = await teamForUser(db, opts.userId);
  if (!team.entitled) {
    const [cap] = await db
      .select({ n: count() })
      .from(documents)
      .where(
        and(
          or(
            eq(documents.userId, opts.userId),
            eq(documents.senderEmail, senderEmail),
          ),
          gte(documents.createdAt, windowStart),
          ne(documents.status, "pending_sender"),
        ),
      );
    if (Number(cap?.n ?? 0) >= limit) {
      return jsonError(429, "Send limit reached. Try again later.", "send_limit");
    }
  }

  const signingDays = Number(env.SIGNING_WINDOW_DAYS);
  const expiresAt = new Date(at.getTime() + signingDays * 86_400_000);
  const fileHash = sha256Hex(opts.bytes);
  const webhookUrl = opts.webhookUrl ?? null;
  const webhookSecret = opts.webhookSecret ?? null;
  if (
    resolved.parties.some((p) => p.kind === "human") &&
    !webhookEncryptionReady()
  ) {
    return jsonError(
      503,
      "Webhook encryption is not configured",
      "webhook_unconfigured",
    );
  }

  let webhookSecretHash: string | null = null;
  if (webhookSecret) {
    try {
      webhookSecretHash = sealWebhookSecret(webhookSecret);
    } catch {
      return jsonError(503, "Webhook encryption is not configured", "webhook_unconfigured");
    }
  }

  const [document] = await db
    .insert(documents)
    .values({
      title: opts.title,
      senderEmail,
      userId: opts.userId,
      status: "pending",
      expiresAt,
      shredAt: expiresAt,
      sha256: fileHash,
      webhookUrl,
      webhookSecretHash,
      fields: opts.fields ?? [],
      signingMode: opts.signingMode ?? "sequential",
      sendEmail: opts.sendEmail ?? true,
      completedRedirectUrl: opts.completedRedirectUrl ?? null,
      embedOrigin: opts.embedOrigin ?? null,
      createdAt: at,
    })
    .returning();

  const storagePath = objectKey(document.id, "original");
  await store.put(storagePath, opts.bytes);
  await db.insert(files).values({
    documentId: document.id,
    kind: "original",
    storagePath,
    fileHash,
  });
  await db.insert(signersTable).values(signerInsertValues(document.id, prepared.prepared));

  const invited = await inviteFirstSigner(db, mailer, document, at);
  return Response.json(
    {
      id: document.id,
      status: "pending",
      signers: invited.signers,
      ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
    },
    { status: 201 },
  );
}

export async function createDocument(req: Request): Promise<Response> {
  if (hasApiKeyQuery(req)) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Expected multipart form data", "invalid_request");
  }

  const title = String(form.get("title") ?? "").trim();
  let senderEmail = String(form.get("sender_email") ?? "").trim().toLowerCase();
  const signersField = form.get("signers");
  const file = form.get("file");

  if (!title) return jsonError(400, "Title is required", "invalid_request");
  if (!senderEmail) {
    return jsonError(400, "Sender email is required", "invalid_request");
  }

  let parsedSigners: z.infer<typeof signersSchema>;
  try {
    const raw =
      typeof signersField === "string" ? JSON.parse(signersField) : signersField;
    const parsed = signersSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "At least one signer is required", "missing_signers");
    }
    parsedSigners = parsed.data;
  } catch {
    return jsonError(400, "At least one signer is required", "missing_signers");
  }

  if (!(file instanceof Blob)) {
    return jsonError(400, "A PDF file is required", "invalid_pdf");
  }
  if (file.size > PDF_MAX_BYTES) {
    return jsonError(400, "PDF exceeds maximum size", "file_too_large");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdf(bytes, file.type)) {
    return jsonError(400, "File must be a PDF", "invalid_pdf");
  }

  const tagged = await parsePdfAndFields(bytes, form.get("fields"));
  if (!tagged.ok) return tagged.response;
  const extras = await parseDocumentExtras({
    valuesRaw: form.get("values"),
    order: form.get("order"),
    sendEmail: form.get("send_email"),
    completedRedirectUrl: form.get("completed_redirect_url"),
    embedOrigin: form.get("embed_origin"),
  });
  if (!extras.ok) return extras.response;

  const webhookField = String(form.get("webhook_url") ?? "").trim();
  let webhookUrl: string | null = null;
  let webhookSecret: string | null = null;
  if (webhookField) {
    const blocked = await webhookUrlError(webhookField);
    if (blocked) return jsonError(400, blocked, "invalid_webhook_url");
    webhookUrl = webhookField;
    webhookSecret = newWebhookSecret();
  }

  const db = requireDb();
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const mailer = requireMailer();
  const at = now();
  const env = getEnv();
  const limit = Number(env.FREE_SEND_LIMIT);
  const windowDays = Number(env.FREE_SEND_WINDOW_DAYS);
  const windowStart = new Date(at.getTime() - windowDays * 86_400_000);

  let liveUserId: string | null = null;
  const raw = bearerToken(req);
  if (raw) {
    if (raw.startsWith("sign_oauth_")) {
      const grant = await lookupOauthGrant(db, raw);
      if (!grant) return jsonError(401, "Unauthorized", "unauthorized");
      const account = await accountForOauthGrant(db, grant);
      if (!account) return jsonError(401, "Unauthorized", "unauthorized");
      liveUserId = account.id;
      senderEmail = account.email;
    } else if (raw.startsWith("sign_live_")) {
      const key = await lookupApiKey(db, raw);
      if (
        !key ||
        key.kind !== "live" ||
        !key.userId ||
        key.expiresAt.getTime() <= at.getTime()
      ) {
        return jsonError(401, "Unauthorized", "unauthorized");
      }
      liveUserId = key.userId;
      const [liveAccount] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, liveUserId));
      if (liveAccount?.email) {
        senderEmail = liveAccount.email.trim().toLowerCase();
      }
    } else {
      return jsonError(401, "Unauthorized", "unauthorized");
    }
  }

  if (liveUserId) {
    return sendPreparedPdf({
      title,
      senderEmail,
      userId: liveUserId,
      signers: parsedSigners,
      bytes: tagged.storedBytes,
      webhookUrl,
      webhookSecret,
      fields: tagged.fields,
      values: extras.extras.docValues,
      signingMode: extras.extras.signingMode,
      sendEmail: extras.extras.sendEmail,
      completedRedirectUrl: extras.extras.completedRedirectUrl,
      embedOrigin: extras.extras.embedOrigin,
    });
  }

  const resolved = await resolveSignerParties(db, parsedSigners, liveUserId);
  if (!resolved.ok) return resolved.response;
  const prepared = prepareParties(
    resolved.parties,
    parsedSigners,
    tagged.fields,
    extras.extras.docValues,
  );
  if (!prepared.ok) return prepared.response;

  const [cap] = await db
    .select({ n: count() })
    .from(documents)
    .where(
      and(
        eq(documents.senderEmail, senderEmail),
        gte(documents.createdAt, windowStart),
        ne(documents.status, "pending_sender"),
      ),
    );
  if (Number(cap?.n ?? 0) >= limit) {
    return jsonError(429, "Send limit reached. Try again later.", "send_limit");
  }

  const signingDays = Number(env.SIGNING_WINDOW_DAYS);
  const expiresAt = new Date(at.getTime() + signingDays * 86_400_000);
  const fileHash = sha256Hex(tagged.storedBytes);

  let webhookSecretHash: string | null = null;
  if (webhookSecret) {
    try {
      webhookSecretHash = sealWebhookSecret(webhookSecret);
    } catch {
      return jsonError(503, "Webhook encryption is not configured", "webhook_unconfigured");
    }
  }

  const [document] = await db
    .insert(documents)
    .values({
      title,
      senderEmail,
      userId: liveUserId,
      status: "pending_sender",
      expiresAt,
      shredAt: expiresAt,
      sha256: fileHash,
      webhookUrl,
      webhookSecretHash,
      fields: tagged.fields,
      signingMode: extras.extras.signingMode,
      sendEmail: extras.extras.sendEmail,
      completedRedirectUrl: extras.extras.completedRedirectUrl,
      embedOrigin: extras.extras.embedOrigin,
      createdAt: at,
    })
    .returning();

  const storagePath = objectKey(document.id, "original");
  await store.put(storagePath, tagged.storedBytes);
  await db.insert(files).values({
    documentId: document.id,
    kind: "original",
    storagePath,
    fileHash,
  });

  await db.insert(signersTable).values(signerInsertValues(document.id, prepared.prepared));

  const otp = await newOtp();
  await db.insert(otpChallenges).values({
    documentId: document.id,
    codeHash: otp.hash,
    expiresAt: new Date(at.getTime() + OTP_TTL_MS),
  });
  try {
    await mailer.sendMail({ to: senderEmail, ...otpEmail(otp.digits) });
    await logEvent(db, { documentId: document.id, event: "otp_sent" });
  } catch (err) {
    await logEvent(db, {
      documentId: document.id,
      event: "emailed_failed",
      payload: { error: err instanceof Error ? err.message : "mail_failed" },
    });
  }

  return Response.json(
    {
      id: document.id,
      status: "pending_sender",
      ...(webhookSecret ? { webhook_secret: webhookSecret } : {}),
    },
    { status: 201 },
  );
}

type DocumentRow = typeof documents.$inferSelect;
type ApiKeyRow = typeof apiKeys.$inferSelect;

type Authed =
  | {
      ok: true;
      db: AuditDb;
      document: DocumentRow;
      via: "key";
      key: ApiKeyRow;
      canDelete: boolean;
    }
  | {
      ok: true;
      db: AuditDb;
      document: DocumentRow;
      via: "session";
      user: AuthUser;
      canDelete: boolean;
    }
  | {
      ok: true;
      db: AuditDb;
      document: DocumentRow;
      via: "oauth";
      user: AuthUser;
      canDelete: boolean;
    }
  | { ok: false; response: Response };

async function teamAccess(
  db: AuditDb,
  documentUserId: string | null,
  callerId: string,
): Promise<{ sender: boolean; member: boolean; owner: boolean }> {
  if (!documentUserId) {
    return { sender: false, member: false, owner: false };
  }
  const team = await teamForUser(db, documentUserId);
  return {
    sender: documentUserId === callerId,
    member: team.memberUserIds.includes(callerId),
    owner: team.ownerUserId === callerId,
  };
}

async function isSignerEmail(
  db: AuditDb,
  documentId: string,
  email: string | null | undefined,
): Promise<boolean> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  const [signed] = await db
    .select()
    .from(signersTable)
    .where(
      and(eq(signersTable.documentId, documentId), eq(signersTable.email, normalized)),
    );
  return Boolean(signed);
}

async function authorizeDocument(req: Request, documentId: string): Promise<Authed> {
  if (hasApiKeyQuery(req)) {
    return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
  }
  const db = requireDb();
  const raw = bearerToken(req);
  if (raw) {
    if (raw.startsWith("sign_oauth_")) {
      const grant = await lookupOauthGrant(db, raw);
      if (!grant) {
        return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
      }
      const account = await accountForOauthGrant(db, grant);
      if (!account) {
        return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
      }
      const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
      if (!document) {
        return { ok: false, response: jsonError(404, "Document not found", "not_found") };
      }
      const access = await teamAccess(db, document.userId, account.id);
      let signed = false;
      if (!access.sender && !access.member) {
        signed = await isSignerEmail(db, documentId, account.email);
      }
      if (!access.sender && !access.member && !signed) {
        return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
      }
      return {
        ok: true,
        db,
        document,
        via: "oauth",
        user: { id: account.id, email: account.email },
        canDelete: access.sender || access.owner,
      };
    }
    if (!raw.startsWith("sign_tmp_") && !raw.startsWith("sign_live_")) {
      return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
    }
    const key = await lookupApiKey(db, raw);
    if (!key) {
      return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
    }
    if (key.kind === "tmp" && key.documentId !== documentId) {
      return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
    }
    const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!document) {
      return { ok: false, response: jsonError(404, "Document not found", "not_found") };
    }
    if (key.kind === "live") {
      if (!key.userId) {
        return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
      }
      const access = await teamAccess(db, document.userId, key.userId);
      let signed = false;
      if (!access.sender && !access.member) {
        const [account] = await db
          .select()
          .from(accounts)
          .where(eq(accounts.userId, key.userId));
        signed = await isSignerEmail(db, documentId, account?.email);
      }
      if (!access.sender && !access.member && !signed) {
        return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
      }
      return {
        ok: true,
        db,
        document,
        via: "key",
        key,
        canDelete: access.sender || access.owner,
      };
    }
    return { ok: true, db, document, via: "key", key, canDelete: true };
  }

  const cookie = req.headers.get("cookie");
  if (!cookie) {
    return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
  }
  const user = await getAuth().userFromCookie(cookie);
  if (!user) {
    return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
  }
  await ensureAccount(db, user);
  await claimSends(db, user.id, user.email);
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!document) {
    return { ok: false, response: jsonError(404, "Document not found", "not_found") };
  }
  const access = await teamAccess(db, document.userId, user.id);
  const signed =
    access.sender || access.member
      ? false
      : await isSignerEmail(db, documentId, user.email);
  if (!access.sender && !access.member && !signed) {
    return { ok: false, response: jsonError(401, "Unauthorized", "unauthorized") };
  }
  return {
    ok: true,
    db,
    document,
    via: "session",
    user,
    canDelete: access.sender || access.owner,
  };
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

async function signerPublicValues(
  store: BlobStore | null,
  documentId: string,
  signerId: string,
  role: string,
  fields: DocumentField[],
  stored: FieldValues,
): Promise<FieldValues> {
  const values: FieldValues = { ...stored };
  for (const field of fields) {
    if (field.role !== role) continue;
    if (field.type !== "signature" && field.type !== "initials") continue;
    let signed = false;
    if (store) {
      const png =
        (await store.get(fieldAppearanceKey(documentId, signerId, field.name))) ??
        (await store.get(appearanceKey(documentId, signerId)));
      signed = Boolean(png);
    }
    if (signed) values[field.name] = "[signed]";
    else delete values[field.name];
  }
  return values;
}

function agentSlugField(
  kind: "human" | "agent",
  agentId: string | null,
  slugById: Map<string, string>,
): { agent?: string } {
  if (kind !== "agent" || !agentId) return {};
  const slug = slugById.get(agentId);
  return slug ? { agent: slug } : {};
}

function keyExpired(authed: Extract<Authed, { ok: true }>): boolean {
  if (authed.via !== "key") return false;
  const keyDead = authed.key.expiresAt.getTime() <= now().getTime();
  if (authed.key.kind === "tmp") {
    return keyDead || authed.document.shredAt.getTime() <= now().getTime();
  }
  return keyDead;
}

export async function listDocuments(req: Request): Promise<Response> {
  if (hasApiKeyQuery(req)) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }
  const db = requireDb();
  const at = now();
  let userId: string | null = null;
  let email: string | null = null;

  const raw = bearerToken(req);
  if (raw) {
    if (raw.startsWith("sign_oauth_")) {
      const grant = await lookupOauthGrant(db, raw);
      if (!grant) return jsonError(401, "Unauthorized", "unauthorized");
      const account = await accountForOauthGrant(db, grant);
      if (!account) return jsonError(401, "Unauthorized", "unauthorized");
      userId = account.id;
      email = account.email;
      await claimSends(db, userId, email);
    } else if (raw.startsWith("sign_live_")) {
      const key = await lookupApiKey(db, raw);
      if (!key || key.kind !== "live" || !key.userId || key.expiresAt.getTime() <= at.getTime()) {
        return jsonError(401, "Unauthorized", "unauthorized");
      }
      userId = key.userId;
      const [account] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, key.userId));
      email = account?.email?.trim().toLowerCase() ?? null;
      if (email) await claimSends(db, userId, email);
    } else {
      return jsonError(401, "Unauthorized", "unauthorized");
    }
  } else {
    const cookie = req.headers.get("cookie");
    if (!cookie) return jsonError(401, "Unauthorized", "unauthorized");
    const user = await getAuth().userFromCookie(cookie);
    if (!user) return jsonError(401, "Unauthorized", "unauthorized");
    await ensureAccount(db, user);
    await claimSends(db, user.id, user.email);
    userId = user.id;
    email = user.email.trim().toLowerCase();
  }

  if (!userId) return jsonError(401, "Unauthorized", "unauthorized");
  const team = await teamForUser(db, userId);
  const senderIds =
    team.memberUserIds.length > 0 ? team.memberUserIds : [userId];
  const sent = await db
    .select()
    .from(documents)
    .where(and(inArray(documents.userId, senderIds), ne(documents.status, "deleted")));
  const byId = new Map(sent.map((e) => [e.id, e]));
  if (email) {
    const signed = await db
      .select({ document: documents })
      .from(signersTable)
      .innerJoin(documents, eq(signersTable.documentId, documents.id))
      .where(
        and(eq(signersTable.email, email), ne(documents.status, "deleted")),
      );
    for (const row of signed) byId.set(row.document.id, row.document);
  }
  const rows = [...byId.values()].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const ownerUserId = team.ownerUserId;
  const documentIds = rows.map((e) => e.id);
  const signerRows =
    documentIds.length === 0
      ? []
      : await db
          .select()
          .from(signersTable)
          .where(inArray(signersTable.documentId, documentIds));
  const agentIds = [
    ...new Set(
      signerRows
        .map((s) => s.agentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const agentRows =
    agentIds.length === 0
      ? []
      : await db.select().from(agents).where(inArray(agents.id, agentIds));
  const slugById = new Map(agentRows.map((a) => [a.id, a.slug]));
  const signersByDocument = new Map<string, typeof signerRows>();
  for (const s of signerRows) {
    const list = signersByDocument.get(s.documentId) ?? [];
    list.push(s);
    signersByDocument.set(s.documentId, list);
  }

  return Response.json({
    documents: rows.map((e) => {
      const parties = (signersByDocument.get(e.id) ?? []).slice();
      parties.sort((a, b) => a.signingOrder - b.signingOrder);
      return {
        id: e.id,
        status: e.status,
        title: e.title,
        sender_email: e.senderEmail,
        created_at: e.createdAt.toISOString(),
        expires_at: e.expiresAt.toISOString(),
        shred_at: e.shredAt.toISOString(),
        can_delete: Boolean(
          (e.userId && e.userId === userId) ||
            (userId === ownerUserId &&
              e.userId &&
              team.memberUserIds.includes(e.userId)),
        ),
        signers: parties.map((s) => ({
          name: s.name,
          kind: s.kind,
          email: s.email,
          ...agentSlugField(s.kind, s.agentId, slugById),
          signed_at: iso(s.signedAt),
          attested_at: iso(s.attestedAt),
        })),
      };
    }),
  });
}

export async function getDocument(req: Request, documentId: string): Promise<Response> {
  if (!documentId) return jsonError(400, "Document id is required", "invalid_request");
  const authed = await authorizeDocument(req, documentId);
  if (!authed.ok) return authed.response;
  const { db, document } = authed;
  if (keyExpired(authed)) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }

  const signerRows = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.documentId, document.id));
  signerRows.sort((a, b) => a.signingOrder - b.signingOrder);

  const agentIds = [
    ...new Set(
      signerRows
        .map((s) => s.agentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const agentRows =
    agentIds.length === 0
      ? []
      : await db.select().from(agents).where(inArray(agents.id, agentIds));
  const slugById = new Map(agentRows.map((a) => [a.id, a.slug]));

  const currentIndex =
    document.status === "pending"
      ? signerRows.findIndex(
          (s) => !s.signedAt && !s.attestedAt && !s.declinedAt && !s.rejectedAt,
        )
      : -1;
  const current = currentIndex >= 0 ? signerRows[currentIndex] : null;
  const current_party = current
    ? {
        index: currentIndex,
        kind: current.kind,
        email: current.email,
        ...agentSlugField(current.kind, current.agentId, slugById),
      }
    : null;

  const auditRows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.documentId, document.id));
  auditRows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const store = requireStore();
  const fields = document.fields ?? [];
  const signersJson = await Promise.all(
    signerRows.map(async (s) => {
      const role = s.roleName || defaultRoleName(s.signingOrder);
      const values = await signerPublicValues(store, document.id, s.id, role, fields, s.values);
      let sign_url: string | undefined;
      if (s.kind !== "agent" && s.tokenEnc) {
        try {
          sign_url = `/s/${openWebhookSecret(s.tokenEnc)}`;
        } catch {
          sign_url = undefined;
        }
      }
      return {
        kind: s.kind,
        email: s.email,
        role,
        values,
        ...agentSlugField(s.kind, s.agentId, slugById),
        sent_at: iso(s.sentAt),
        opened_at: iso(s.openedAt),
        consented_at: iso(s.consentedAt),
        signed_at: iso(s.signedAt),
        attested_at: iso(s.attestedAt),
        declined_at: iso(s.declinedAt),
        rejected_at: iso(s.rejectedAt),
        reminded_at: iso(s.remindedAt),
        ...(sign_url ? { sign_url } : {}),
      };
    }),
  );

  return Response.json({
    id: document.id,
    status: document.status,
    title: document.title,
    expires_at: document.expiresAt.toISOString(),
    shred_at: document.shredAt.toISOString(),
    fields,
    signing_mode: document.signingMode,
    send_email: document.sendEmail,
    current_party,
    signers: signersJson,
    audit: auditRows.map((a) => ({ event: a.event, at: a.createdAt.toISOString() })),
  });
}

export async function getDocumentPdf(req: Request, documentId: string): Promise<Response> {
  if (!documentId) return jsonError(400, "Document id is required", "invalid_request");
  const authed = await authorizeDocument(req, documentId);
  if (!authed.ok) return authed.response;
  const { document } = authed;
  if (document.status === "deleted") {
    return jsonError(410, "Document has been deleted", "deleted");
  }
  if (keyExpired(authed)) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }
  if (document.status !== "completed") {
    return jsonError(409, "Document is not completed", "not_completed");
  }
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const kind =
    new URL(req.url).searchParams.get("kind") === "certificate"
      ? "certificate"
      : "sealed";
  const bytes = await store.get(objectKey(document.id, kind));
  if (!bytes) {
    return jsonError(410, "Document has been deleted", "deleted");
  }
  const filename =
    kind === "certificate" ? `${document.id}-certificate.pdf` : `${document.id}.pdf`;
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function deleteDocument(req: Request, documentId: string): Promise<Response> {
  if (!documentId) return jsonError(400, "Document id is required", "invalid_request");
  const authed = await authorizeDocument(req, documentId);
  if (!authed.ok) return authed.response;
  if (!authed.canDelete) {
    return jsonError(403, "Signers cannot void this document", "forbidden");
  }
  const { db, document } = authed;
  if (keyExpired(authed)) {
    return jsonError(401, "Unauthorized", "unauthorized");
  }
  if (document.status === "deleted") {
    return jsonError(409, "Document is already deleted", "invalid_state");
  }
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const at = now();
  await purgeDocument(db, store, document.id, at, { force: true });
  return Response.json({ id: document.id, status: "deleted", message: "Void." });
}
