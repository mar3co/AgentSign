import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import {
  accounts,
  agents,
  files,
  documents,
  signers as signersTable,
} from "../db/schema.js";
import { getEnv } from "../env.js";
import { logEvent, type AuditDb } from "../lib/audit.js";
import { loadBrand, parseLogo } from "../lib/branding.js";
import { publicSignUrl } from "../lib/signing-url.js";
import { teamForUser } from "../lib/team.js";
import { getDeps, storeUnavailableResponse } from "../lib/deps.js";
import {
  brandMailAttachments,
  completionAttachments,
  completionEmail,
  createMailer,
  declineEmail,
  inviteEmail,
  type Mailer,
} from "../lib/email.js";
import { sha256Hex } from "../lib/hash.js";
import type { CertificateField } from "../lib/pdf/certificate.js";
import { completeDocumentPdf } from "../lib/pdf/complete.js";
import { loadSigningP12 } from "../lib/pdf/devP12.js";
import type { BurnParty } from "../lib/pdf/burnFields.js";
import { defaultRoleName, type DocumentField } from "../lib/pdf/fields.js";
import type { SignatureAppearance } from "../lib/pdf/appendSignaturePage.js";
import {
  appearanceKey,
  fieldAppearanceKey,
  objectKey,
  type BlobStore,
} from "../lib/storage.js";
import { hashSigningToken, newSigningToken } from "../lib/tokens.js";
import {
  fireAgentPartyReady,
  fireAgentPartyWebhooks,
  fireDocumentCompleted,
  fireDocumentWebhook,
  openWebhookSecret,
  sealWebhookSecret,
  webhookEncryptionReady,
} from "../lib/webhooks.js";
import { syncTmpKeyExpiry } from "../lib/keys.js";

export const CONSENT_TEXT =
  "I agree to sign this document electronically. I consent to receiving and storing records electronically. My signature is intended to be as binding as a handwritten signature under applicable law, including ESIGN and UETA. This is not legal advice. This is not a notary service.";

const consentSchema = z.object({
  consent: z.literal(true),
});

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
}

const PNG_MAX_BYTES = 1_000_000;

type FieldValues = Record<string, string | boolean>;

function signerRole(signer: SignerRow): string {
  return signer.roleName || defaultRoleName(signer.signingOrder);
}

function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function checkboxChecked(value: unknown): boolean {
  return value === true || value === "true";
}

function valuesAgree(posted: string | boolean, stored: string | boolean | undefined): boolean {
  if (stored === undefined) return false;
  if (posted === stored) return true;
  if (checkboxChecked(posted) && checkboxChecked(stored)) return true;
  if (
    (posted === false || posted === "false") &&
    (stored === false || stored === "false")
  ) {
    return true;
  }
  return false;
}

async function parseSignValues(
  form: FormData,
): Promise<{ ok: true; values: FieldValues } | { ok: false; error: Response }> {
  const raw = form.get("values");
  if (raw == null || raw === "") return { ok: true, values: {} };
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (raw instanceof Blob) text = await raw.text();
  else return { ok: false, error: jsonError(400, "Invalid values", "invalid_values") };
  if (text.trim() === "") return { ok: true, values: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: jsonError(400, "Invalid values", "invalid_values") };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: jsonError(400, "Invalid values", "invalid_values") };
  }
  const values: FieldValues = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== "string" && typeof v !== "boolean") {
      return { ok: false, error: jsonError(400, "Invalid values", "invalid_values") };
    }
    values[k] = v;
  }
  return { ok: true, values };
}

async function readPngPart(part: FormDataEntryValue | null): Promise<Uint8Array | null> {
  if (!(part instanceof Blob)) return null;
  return new Uint8Array(await part.arrayBuffer());
}

function certificateFields(
  fields: DocumentField[],
  parties: BurnParty[],
): CertificateField[] {
  return fields.map((field) => {
    const party = parties.find((p) => p.role === field.role);
    let value = "";
    if (field.type === "signature" || field.type === "initials") {
      value = party?.pngs[field.name] ? "drawn" : "";
    } else if (field.type === "checkbox") {
      value = checkboxChecked(party?.values[field.name]) ? "yes" : "no";
    } else {
      const v = party?.values[field.name];
      value = v == null ? "" : String(v);
    }
    return { role: field.role, name: field.name, type: field.type, value };
  });
}

async function webhookFieldValues(
  store: BlobStore | null,
  documentId: string,
  fields: DocumentField[],
  parties: SignerRow[],
  onlySignerId?: string,
): Promise<Array<{ role: string; name: string; type: string; value: string }>> {
  if (fields.length === 0) return [];
  const out: Array<{ role: string; name: string; type: string; value: string }> = [];
  for (const field of fields) {
    const party = parties.find((s) => signerRole(s) === field.role);
    if (!party) continue;
    if (onlySignerId && party.id !== onlySignerId) continue;
    let value = "";
    if (field.type === "signature" || field.type === "initials") {
      let signed = false;
      if (store) {
        const png = await store.get(
          fieldAppearanceKey(documentId, party.id, field.name),
        );
        signed = Boolean(png);
      }
      if (!signed) continue;
      value = "[signed]";
    } else if (field.type === "checkbox") {
      value = checkboxChecked(party.values?.[field.name]) ? "true" : "false";
    } else {
      const v = party.values?.[field.name];
      value = v == null ? "" : String(v);
    }
    out.push({ role: field.role, name: field.name, type: field.type, value });
  }
  return out;
}

async function buildFieldParties(
  store: BlobStore,
  documentId: string,
  fields: DocumentField[],
  allSigners: SignerRow[],
  current: SignerRow,
  at: Date,
  claim: CompleteClaim,
): Promise<BurnParty[]> {
  const parties: BurnParty[] = [];
  for (const s of allSigners) {
    const role = signerRole(s);
    const pngs: Record<string, Uint8Array> = {};
    for (const field of fields) {
      if (field.role !== role) continue;
      if (field.type !== "signature" && field.type !== "initials") continue;
      const bytes = await store.get(
        fieldAppearanceKey(documentId, s.id, field.name),
      );
      if (bytes) pngs[field.name] = bytes;
    }
    const signedAt =
      s.id === current.id
        ? claim === "sign"
          ? at
          : (s.attestedAt ?? s.signedAt ?? at)
        : (s.signedAt ?? s.attestedAt);
    parties.push({
      role,
      kind: s.kind,
      name: s.name,
      email: s.email,
      signedAt: signedAt ?? at,
      values: s.values ?? {},
      pngs,
    });
  }
  return parties;
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

function clientIp(req: Request): string | undefined {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("cf-connecting-ip") ?? undefined;
}

function signingP12(): { p12: Buffer; passphrase: string } {
  const deps = getDeps();
  if (deps.p12 && deps.p12Passphrase != null) {
    return { p12: deps.p12, passphrase: deps.p12Passphrase };
  }
  return loadSigningP12();
}

export type SignerRow = typeof signersTable.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;

/** A party has acted if they signed, attested, declined, or rejected. */
export function partyDone(
  s: Pick<SignerRow, "signedAt" | "attestedAt" | "declinedAt" | "rejectedAt">,
): boolean {
  return Boolean(s.signedAt || s.attestedAt || s.declinedAt || s.rejectedAt);
}

type Loaded =
  | { ok: true; db: AuditDb; signer: SignerRow; document: DocumentRow }
  | { ok: false; error: Response };

async function loadSigner(token: string): Promise<Loaded> {
  if (!token) return { ok: false, error: jsonError(404, "Not found", "not_found") };
  const db = requireDb();
  const [signer] = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.tokenHash, hashSigningToken(token)));
  if (!signer) return { ok: false, error: jsonError(404, "Not found", "not_found") };
  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, signer.documentId));
  if (!document) return { ok: false, error: jsonError(404, "Not found", "not_found") };
  return { ok: true, db, signer, document };
}

async function sequentialWait(
  db: AuditDb,
  signer: SignerRow,
  document: DocumentRow,
): Promise<Response | null> {
  if (document.signingMode === "parallel") return null;
  if (signer.signingOrder <= 1) return null;
  const [prev] = await db
    .select()
    .from(signersTable)
    .where(
      and(
        eq(signersTable.documentId, signer.documentId),
        eq(signersTable.signingOrder, signer.signingOrder - 1),
      ),
    );
  if (prev && !partyDone(prev)) {
    return jsonError(409, "Waiting on previous signer.", "sequential_wait");
  }
  return null;
}

export async function buildCompleteAppearances(
  store: BlobStore,
  documentId: string,
  allSigners: SignerRow[],
  currentId: string,
  at: Date,
  currentPng?: Uint8Array,
  requirePriorPng = true,
): Promise<
  { ok: true; appearances: SignatureAppearance[] } | { ok: false; error: Response }
> {
  const appearances: SignatureAppearance[] = [];
  for (const s of allSigners) {
    const isCurrent = s.id === currentId;
    if (s.kind === "agent") {
      appearances.push({
        kind: "agent",
        name: s.name,
        email: s.email,
        signedAt: isCurrent ? at : (s.attestedAt ?? s.signedAt ?? at),
      });
      continue;
    }
    if (isCurrent) {
      appearances.push({
        kind: "human",
        png: currentPng,
        name: s.name,
        email: s.email,
        signedAt: at,
      });
      continue;
    }
    if (!s.signedAt) continue;
    const prior = await store.get(appearanceKey(documentId, s.id));
    if (!prior && requirePriorPng) {
      return {
        ok: false,
        error: jsonError(500, "Prior signature missing", "missing_appearance"),
      };
    }
    appearances.push({
      kind: "human",
      png: prior ?? undefined,
      name: s.name,
      email: s.email,
      signedAt: s.signedAt,
    });
  }
  return { ok: true, appearances };
}

type CompleteClaim = "sign" | "attest";

export async function commitCompletedDocument(opts: {
  db: AuditDb;
  document: DocumentRow;
  signer: SignerRow;
  allSigners: SignerRow[];
  at: Date;
  ip: string | null;
  ua: string | null;
  appearances: SignatureAppearance[];
  claim: CompleteClaim;
  attestMethod?: "agent_key" | "oauth" | null;
  attestLabel?: string | null;
  alreadyClaimed?: boolean;
}): Promise<Response> {
  const {
    db,
    document,
    signer,
    allSigners,
    at,
    ip,
    ua,
    appearances,
    claim,
    attestMethod = null,
    attestLabel = null,
    alreadyClaimed = false,
  } = opts;
  const store = requireStore();
  if (!store) return storeUnavailableResponse();

  const original = await store.get(objectKey(document.id, "original"));
  if (!original) {
    return jsonError(500, "Original document missing", "missing_original");
  }

  let keepDays = Number(getEnv().FREE_KEEP_DAYS);
  const proDays = Number(getEnv().PRO_KEEP_DAYS);
  let footer: string | undefined = "Sent with AgentSign";
  if (document.userId) {
    const team = await teamForUser(db, document.userId);
    if (team.entitled) {
      keepDays = proDays;
      footer = undefined;
    }
  }
  const emails = new Set(
    allSigners.map((s) => s.email.trim().toLowerCase()).filter(Boolean),
  );
  if (emails.size > 0) {
    const signerAccounts = await db
      .select()
      .from(accounts)
      .where(inArray(accounts.email, [...emails]));
    if (signerAccounts.some((a) => a.plan === "pro")) keepDays = proDays;
  }

  const agentIds = [
    ...new Set(
      allSigners
        .map((s) => s.agentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const slugByAgentId = new Map<string, string>();
  if (agentIds.length > 0) {
    const rows = await db.select().from(agents).where(inArray(agents.id, agentIds));
    for (const row of rows) slugByAgentId.set(row.id, row.slug);
  }

  const pages = appearances.map((a) => (footer ? { ...a, footer } : a));
  const docFields = document.fields ?? [];
  const useFields = docFields.length > 0;
  let fieldParties: BurnParty[] | undefined;
  let certFields: CertificateField[] | undefined;
  if (useFields) {
    const live = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, document.id));
    live.sort((a, b) => a.signingOrder - b.signingOrder);
    fieldParties = await buildFieldParties(
      store,
      document.id,
      docFields,
      live,
      signer,
      at,
      claim,
    );
    certFields = certificateFields(docFields, fieldParties);
  }

  let result: Awaited<ReturnType<typeof completeDocumentPdf>>;
  try {
    const { p12, passphrase } = signingP12();
    result = await completeDocumentPdf({
      original,
      appearances: pages,
      ...(useFields ? { fields: docFields, fieldParties } : {}),
      p12,
      passphrase,
      meta: {
        documentId: document.id,
        title: document.title,
        senderEmail: document.senderEmail,
        consentText: CONSENT_TEXT,
        signers: allSigners.map((s) => ({
          name: s.name,
          email: s.email,
          kind: s.kind,
          sentAt: s.sentAt,
          openedAt: s.openedAt,
          consentedAt:
            s.id === signer.id && claim === "sign" ? s.consentedAt ?? at : s.consentedAt,
          signedAt: s.id === signer.id && claim === "sign" ? at : s.signedAt,
          declinedAt: s.declinedAt,
          attestedAt:
            s.id === signer.id && claim === "attest" ? at : s.attestedAt,
          attestMethod:
            s.id === signer.id && claim === "attest" ? attestMethod : s.attestMethod,
          attestLabel:
            s.id === signer.id && claim === "attest" ? attestLabel : s.attestLabel,
          agentSlug: s.agentId ? slugByAgentId.get(s.agentId) ?? null : null,
          ip: s.id === signer.id ? ip : s.ip,
          ua: s.id === signer.id ? ua : s.ua,
        })),
        ...(certFields ? { fields: certFields } : {}),
      },
    });
  } catch {
    return jsonError(500, "Failed to complete document", "complete_failed");
  }
  const shredAt = new Date(at.getTime() + keepDays * 86_400_000);
  const sealedPath = objectKey(document.id, "sealed");
  const certPath = objectKey(document.id, "certificate");

  try {
    await db.transaction(async (tx) => {
      if (!alreadyClaimed) {
        const [claimed] =
          claim === "sign"
            ? await tx
                .update(signersTable)
                .set({ signedAt: at, ip, ua })
                .where(
                  and(
                    eq(signersTable.id, signer.id),
                    isNull(signersTable.signedAt),
                    isNull(signersTable.declinedAt),
                  ),
                )
                .returning()
            : await tx
                .update(signersTable)
                .set({
                  attestedAt: at,
                  attestMethod,
                  attestLabel,
                })
                .where(
                  and(
                    eq(signersTable.id, signer.id),
                    eq(signersTable.kind, "agent"),
                    isNull(signersTable.attestedAt),
                    isNull(signersTable.rejectedAt),
                  ),
                )
                .returning();
        if (!claimed) throw new Error("complete_conflict");
      }
      const [updated] = await tx
        .update(documents)
        .set({ status: "completed", sha256: result.sha256, shredAt })
        .where(and(eq(documents.id, document.id), eq(documents.status, "pending")))
        .returning();
      if (!updated) throw new Error("complete_conflict");
      await tx.insert(files).values([
        {
          documentId: document.id,
          kind: "sealed",
          storagePath: sealedPath,
          fileHash: result.sha256,
        },
        {
          documentId: document.id,
          kind: "certificate",
          storagePath: certPath,
          fileHash: sha256Hex(result.certificate),
        },
      ]);
    });
  } catch {
    if (alreadyClaimed) {
      const [env] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, document.id));
      if (env?.status === "completed" && env.sha256) {
        return Response.json({
          status: "completed",
          shred_at: env.shredAt.toISOString(),
          sha256: env.sha256,
        });
      }
    }
    return jsonError(409, "Document is not awaiting signature", "invalid_state");
  }
  try {
    await store.put(sealedPath, result.sealed);
    await store.put(certPath, result.certificate);
  } catch {
    await db
      .update(documents)
      .set({
        status: "pending",
        sha256: null,
        shredAt: document.shredAt,
      })
      .where(eq(documents.id, document.id));
    await db
      .delete(files)
      .where(
        and(
          eq(files.documentId, document.id),
          inArray(files.kind, ["sealed", "certificate"]),
        ),
      );
    if (!alreadyClaimed) {
      if (claim === "sign") {
        await db
          .update(signersTable)
          .set({ signedAt: null })
          .where(eq(signersTable.id, signer.id));
      } else {
        await db
          .update(signersTable)
          .set({ attestedAt: null, attestMethod: null, attestLabel: null })
          .where(eq(signersTable.id, signer.id));
      }
    }
    return jsonError(500, "Failed to complete document", "complete_failed");
  }
  if (!alreadyClaimed) {
    await logEvent(db, {
      documentId: document.id,
      signerId: signer.id,
      event: claim === "sign" ? "signed" : "attested",
      ip: claim === "sign" ? ip ?? undefined : undefined,
      ua: claim === "sign" ? ua ?? undefined : undefined,
    });
  }
  try {
    await syncTmpKeyExpiry(db, document.id, shredAt);
  } catch {
    // document is already completed
  }

  const mailer = requireMailer();
  const docs = completionAttachments(result.sealed, result.certificate);
  const brand = await loadBrand(db, document.userId, store);
  const logo = brandMailAttachments(brand.logoBytes);
  const attachments = [...(docs ?? []), ...(logo ?? [])];
  const recipients = new Set<string>([
    document.senderEmail,
    ...allSigners.map((s) => s.email),
  ]);
  for (const to of recipients) {
    try {
      const body = completionEmail({
        to,
        title: document.title,
        shredAt,
        includeAttachments: Boolean(docs),
        senderEmail: document.senderEmail,
        brand: {
          displayName: brand.displayName,
          hasLogo: Boolean(brand.logoBytes),
        },
      });
      await mailer.sendMail({
        to,
        subject: body.subject,
        text: body.text,
        html: body.html,
        attachments: attachments.length ? attachments : undefined,
      });
      await logEvent(db, {
        documentId: document.id,
        event: "emailed",
        payload: { to, kind: "completion" },
      });
    } catch (err) {
      await logEvent(db, {
        documentId: document.id,
        event: "emailed_failed",
        payload: {
          to,
          error: err instanceof Error ? err.message : "mail_failed",
        },
      });
    }
  }

  try {
    await fireSignerCompletedWebhook(db, document, signer, "completed");
  } catch {
    // delivery audits webhook_failed
  }
  const liveParties = (
    await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, document.id))
  ).sort((a, b) => a.signingOrder - b.signingOrder);
  const needsCompletedAppearances = docFields.some(
    (f) => f.type === "signature" || f.type === "initials",
  );
  let completedValues: Array<{
    role: string;
    name: string;
    type: string;
    value: string;
  }> = [];
  try {
    completedValues = await webhookFieldValues(
      needsCompletedAppearances ? store : null,
      document.id,
      docFields,
      liveParties,
    );
  } catch {
    completedValues = await webhookFieldValues(
      null,
      document.id,
      docFields,
      liveParties,
    );
  }
  try {
    await fireDocumentCompleted(db, document, {
      event: "document.completed",
      id: document.id,
      status: "completed",
      sha256: result.sha256,
      shred_at: shredAt,
      ...(completedValues.length ? { values: completedValues } : {}),
    });
  } catch (err) {
    await logEvent(db, {
      documentId: document.id,
      event: "webhook_failed",
      payload: { error: err instanceof Error ? err.message : "webhook_failed" },
    });
  }
  try {
    await fireAgentPartyWebhooks(db, document.id, {
      event: "document.completed",
      status: "completed",
    });
  } catch (err) {
    await logEvent(db, {
      documentId: document.id,
      event: "webhook_failed",
      payload: { error: err instanceof Error ? err.message : "webhook_failed" },
    });
  }
  return Response.json({
    status: "completed",
    shred_at: shredAt.toISOString(),
    sha256: result.sha256,
  });
}

/** After claiming a party, seal if every party is now done (parallel last-two race). */
export async function completeIfAllPartiesDone(opts: {
  db: AuditDb;
  document: DocumentRow;
  signer: SignerRow;
  at: Date;
  ip: string | null;
  ua: string | null;
  currentPng?: Uint8Array;
  claim: CompleteClaim;
  attestMethod?: "agent_key" | "oauth" | null;
  attestLabel?: string | null;
}): Promise<Response | null> {
  const live = await opts.db
    .select()
    .from(signersTable)
    .where(eq(signersTable.documentId, opts.document.id));
  live.sort((a, b) => a.signingOrder - b.signingOrder);
  if (!live.every(partyDone)) return null;
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const built = await buildCompleteAppearances(
    store,
    opts.document.id,
    live,
    opts.signer.id,
    opts.at,
    opts.currentPng,
    (opts.document.fields ?? []).length === 0,
  );
  if (!built.ok) return built.error;
  return commitCompletedDocument({
    db: opts.db,
    document: opts.document,
    signer: opts.signer,
    allSigners: live,
    at: opts.at,
    ip: opts.ip,
    ua: opts.ua,
    appearances: built.appearances,
    claim: opts.claim,
    attestMethod: opts.attestMethod,
    attestLabel: opts.attestLabel,
    alreadyClaimed: true,
  });
}

export async function fireSignerCompletedWebhook(
  db: AuditDb,
  document: DocumentRow,
  party: SignerRow,
  status: string,
): Promise<void> {
  const fields = document.fields ?? [];
  const role = signerRole(party);
  const needsAppearances = fields.some(
    (f) =>
      f.role === role && (f.type === "signature" || f.type === "initials"),
  );
  const store = needsAppearances ? requireStore() : null;
  const parties = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.documentId, document.id));
  parties.sort((a, b) => a.signingOrder - b.signingOrder);
  let values: Array<{ role: string; name: string; type: string; value: string }> =
    [];
  try {
    values = await webhookFieldValues(
      store,
      document.id,
      fields,
      parties,
      party.id,
    );
  } catch {
    values = await webhookFieldValues(null, document.id, fields, parties, party.id);
  }
  await fireDocumentWebhook(db, document, {
    event: "signer.completed",
    id: document.id,
    status,
    signer_email: party.email,
    kind: party.kind === "agent" ? "agent" : "human",
    ...(values.length ? { values } : {}),
  });
}

export async function inviteNextHumanIfNeeded(
  db: AuditDb,
  document: DocumentRow,
  allSigners: SignerRow[],
  current: SignerRow,
  at: Date,
  rollbackCurrent: () => Promise<void>,
): Promise<Response | null> {
  if (document.signingMode === "parallel") return null;
  const next = allSigners.find((s) => s.signingOrder === current.signingOrder + 1);
  if (!next || partyDone(next) || next.sentAt) return null;
  const [live] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, document.id));
  if (!live || live.status !== "pending") {
    await rollbackCurrent();
    return jsonError(409, "Document is not awaiting signature", "invalid_state");
  }
  if (next.kind === "agent") {
    await fireAgentPartyReady(db, document, next);
    return null;
  }
  if (!webhookEncryptionReady()) {
    await rollbackCurrent();
    return jsonError(
      503,
      "Webhook encryption is not configured",
      "webhook_unconfigured",
    );
  }

  const store = requireStore();
  let raw: string;
  let tokenHash = next.tokenHash;
  let tokenEnc = next.tokenEnc;
  if (tokenEnc) {
    raw = openWebhookSecret(tokenEnc);
  } else {
    const token = newSigningToken();
    raw = token.raw;
    tokenHash = token.hash;
    tokenEnc = sealWebhookSecret(token.raw);
  }
  const [slot] = await db
    .update(signersTable)
    .set({ sentAt: at, tokenHash, tokenEnc })
    .where(and(eq(signersTable.id, next.id), isNull(signersTable.sentAt)))
    .returning();
  if (!slot) return null;

  if (document.sendEmail === false) {
    await logEvent(db, {
      documentId: document.id,
      signerId: next.id,
      event: "sent",
    });
    return null;
  }

  const mailer = requireMailer();
  const brand = await loadBrand(db, document.userId, store);
  const invite = inviteEmail({
    signUrl: publicSignUrl(raw),
    senderEmail: document.senderEmail,
    title: document.title,
    expiresAt: document.expiresAt,
    message: document.message,
    brand: {
      displayName: brand.displayName,
      hasLogo: Boolean(brand.logoBytes),
    },
  });
  try {
    await mailer.sendMail({
      to: next.email,
      ...invite,
      attachments: brandMailAttachments(brand.logoBytes),
    });
    await logEvent(db, {
      documentId: document.id,
      signerId: next.id,
      event: "sent",
    });
    await logEvent(db, {
      documentId: document.id,
      signerId: next.id,
      event: "emailed",
    });
  } catch (err) {
    await rollbackCurrent();
    await db
      .update(signersTable)
      .set({ sentAt: null })
      .where(eq(signersTable.id, next.id));
    await logEvent(db, {
      documentId: document.id,
      signerId: next.id,
      event: "emailed_failed",
      payload: { error: err instanceof Error ? err.message : "mail_failed" },
    });
    return jsonError(503, "Could not email the next signer", "invite_failed");
  }
  return null;
}

export async function getSigningState(
  token: string,
  req?: Request,
): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { db, signer, document } = loaded;
  const at = now();

  if (document.status === "deleted") {
    return jsonError(410, "This link has expired", "deleted");
  }

  if (!signer.signedAt && document.expiresAt.getTime() <= at.getTime()) {
    return jsonError(410, "This link has expired", "expired");
  }

  const wait = await sequentialWait(db, signer, document);
  if (wait && !signer.signedAt) return wait;

  if (!signer.openedAt) {
    await db
      .update(signersTable)
      .set({ openedAt: at })
      .where(eq(signersTable.id, signer.id));
    await logEvent(db, {
      documentId: document.id,
      signerId: signer.id,
      event: "opened",
      ip: req ? clientIp(req) : undefined,
      ua: req?.headers.get("user-agent") ?? undefined,
    });
    if (signer.kind !== "agent") {
      try {
        await fireDocumentWebhook(db, document, {
          event: "document.opened",
          id: document.id,
          status: document.status,
          signer_email: signer.email,
        });
      } catch {
        // delivery audits webhook_failed; open still succeeds
      }
    }
  }

  let display_name: string | null = null;
  let has_logo = false;
  if (document.userId) {
    const team = await teamForUser(db, document.userId);
    if (team.entitled) {
      display_name = team.displayName;
      has_logo = Boolean(team.logoPath);
    }
  }

  const parties = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.documentId, document.id));
  parties.sort((a, b) => a.signingOrder - b.signingOrder);
  const earlierAgents = parties.filter(
    (s) =>
      s.signingOrder < signer.signingOrder &&
      s.kind === "agent" &&
      Boolean(s.attestedAt),
  );
  const agentIds = [
    ...new Set(
      earlierAgents
        .map((s) => s.agentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const slugRows =
    agentIds.length === 0
      ? []
      : await db.select().from(agents).where(inArray(agents.id, agentIds));
  const slugById = new Map(slugRows.map((row) => [row.id, row.slug]));
  const attested = earlierAgents
    .map((s) => {
      const slug = s.agentId ? slugById.get(s.agentId) : undefined;
      if (!slug) return null;
      return { slug, email: s.email };
    })
    .filter((row): row is { slug: string; email: string } => Boolean(row));

  const role = signerRole(signer);
  const partyFields = (document.fields ?? []).filter((f) => f.role === role);

  return Response.json({
    title: document.title,
    signerName: signer.name,
    signerEmail: signer.email,
    sequentialWait: false,
    expiresAt: document.expiresAt.toISOString(),
    shredAt: document.shredAt.toISOString(),
    signed: Boolean(signer.signedAt),
    declined: Boolean(signer.declinedAt),
    status: document.status,
    display_name,
    has_logo,
    attested,
    id: document.id,
    fields: partyFields,
    values: signer.values ?? {},
    signing_mode: document.signingMode,
    completed_redirect_url: document.completedRedirectUrl,
    embed_origin: document.embedOrigin,
  });
}

export async function getCeremonyLogo(
  _req: Request,
  token: string,
): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { db, signer, document } = loaded;
  if (document.status === "deleted") {
    return jsonError(410, "This link has expired", "deleted");
  }
  if (!signer.signedAt && document.expiresAt.getTime() <= now().getTime()) {
    return jsonError(410, "This link has expired", "expired");
  }
  if (!document.userId) {
    return jsonError(404, "Not found", "not_found");
  }
  const team = await teamForUser(db, document.userId);
  if (!team.entitled || !team.logoPath) {
    return jsonError(404, "Not found", "not_found");
  }
  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const bytes = await store.get(team.logoPath);
  if (!bytes) {
    return jsonError(404, "Not found", "not_found");
  }
  const parsed = parseLogo(bytes);
  if (!parsed.ok) {
    return jsonError(404, "Not found", "not_found");
  }
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: { "content-type": parsed.contentType },
  });
}

export async function postConsent(
  req: Request,
  token: string,
): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { db, signer, document } = loaded;
  const at = now();

  if (document.expiresAt.getTime() <= at.getTime()) {
    return jsonError(410, "This link has expired", "expired");
  }
  if (document.status !== "pending" || signer.declinedAt || signer.signedAt) {
    return jsonError(409, "Document is not awaiting signature", "invalid_state");
  }
  const wait = await sequentialWait(db, signer, document);
  if (wait) return wait;

  try {
    consentSchema.parse(await req.json());
  } catch {
    return jsonError(400, "Consent is required", "consent_required");
  }

  const ip = clientIp(req) ?? null;
  const ua = req.headers.get("user-agent");
  await db
    .update(signersTable)
    .set({ consentedAt: at, consentUa: ua, ip })
    .where(eq(signersTable.id, signer.id));
  await logEvent(db, {
    documentId: document.id,
    signerId: signer.id,
    event: "consented",
    ip: ip ?? undefined,
    ua: ua ?? undefined,
  });
  return Response.json({ ok: true });
}

export async function postSign(req: Request, token: string): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { db, signer, document } = loaded;
  const at = now();
  const store = requireStore();
  if (!store) return storeUnavailableResponse();

  if (document.expiresAt.getTime() <= at.getTime() && document.status === "pending") {
    return jsonError(410, "This link has expired", "expired");
  }
  if (document.status !== "pending" || signer.declinedAt || signer.signedAt) {
    return jsonError(409, "Document is not awaiting signature", "invalid_state");
  }
  const wait = await sequentialWait(db, signer, document);
  if (wait) return wait;
  if (!signer.consentedAt) {
    return jsonError(400, "Consent is required before signing", "consent_required");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Expected multipart form data", "invalid_request");
  }

  const docFields = document.fields ?? [];
  const partyFields = docFields.filter((f) => f.role === signerRole(signer));
  let currentPng: Uint8Array | undefined;

  if (partyFields.length > 0) {
    const parsed = await parseSignValues(form);
    if (!parsed.ok) return parsed.error;
    const posted = parsed.values;
    const signatureCount = partyFields.filter((f) => f.type === "signature").length;
    const pngs = new Map<string, Uint8Array>();
    const nextValues: FieldValues = {};

    for (const field of partyFields) {
      const stored = signer.values?.[field.name];
      const rawPosted = posted[field.name];

      if (field.readonly) {
        if (rawPosted !== undefined && !valuesAgree(rawPosted, stored)) {
          return jsonError(400, "Invalid values", "invalid_values");
        }
        if (stored !== undefined) nextValues[field.name] = stored;
        continue;
      }

      if (field.type === "checkbox") {
        const checked = checkboxChecked(rawPosted);
        if (field.required && !checked) {
          return jsonError(400, "Invalid values", "invalid_values");
        }
        nextValues[field.name] = checked;
        continue;
      }

      if (field.type === "signature" || field.type === "initials") {
        const named = await readPngPart(form.get(`sig:${field.name}`));
        const fallback =
          field.type === "signature" && signatureCount === 1
            ? await readPngPart(form.get("png"))
            : null;
        const pngBytes = named ?? fallback;
        if (!pngBytes || pngBytes.byteLength === 0) {
          if (field.required) {
            return jsonError(400, "Invalid values", "invalid_values");
          }
          continue;
        }
        if (pngBytes.byteLength > PNG_MAX_BYTES || !isPng(pngBytes)) {
          return jsonError(400, "A PNG signature is required", "invalid_png");
        }
        pngs.set(field.name, pngBytes);
        continue;
      }

      let text =
        typeof rawPosted === "string"
          ? rawPosted
          : rawPosted === undefined
            ? ""
            : String(rawPosted);
      if (field.type === "date" && text.trim() === "") text = utcDate(at);
      if (field.type === "name" && text.trim() === "") text = signer.name;
      if (field.required && text.trim() === "") {
        return jsonError(400, "Invalid values", "invalid_values");
      }
      nextValues[field.name] = text;
    }

    await db
      .update(signersTable)
      .set({ values: nextValues })
      .where(eq(signersTable.id, signer.id));

    for (const [name, bytes] of pngs) {
      await store.put(fieldAppearanceKey(document.id, signer.id, name), bytes);
    }
    const firstSig = partyFields.find((f) => f.type === "signature" && pngs.has(f.name));
    currentPng = firstSig ? pngs.get(firstSig.name) : pngs.values().next().value;
    if (currentPng) {
      await store.put(appearanceKey(document.id, signer.id), currentPng);
    }
  } else {
    const file = form.get("png");
    if (!(file instanceof Blob)) {
      return jsonError(400, "A PNG signature is required", "invalid_png");
    }
    const png = new Uint8Array(await file.arrayBuffer());
    if (png.byteLength > PNG_MAX_BYTES || !isPng(png)) {
      return jsonError(400, "A PNG signature is required", "invalid_png");
    }
    currentPng = png;
    await store.put(appearanceKey(document.id, signer.id), png);
  }

  const ip = clientIp(req) ?? signer.ip;
  const ua = req.headers.get("user-agent") ?? signer.ua;

  const allSigners = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.documentId, document.id));
  allSigners.sort((a, b) => a.signingOrder - b.signingOrder);
  const last = allSigners.every((s) => s.id === signer.id || partyDone(s));

  if (last) {
    const built = await buildCompleteAppearances(
      store,
      document.id,
      allSigners,
      signer.id,
      at,
      currentPng,
      docFields.length === 0,
    );
    if (!built.ok) return built.error;
    return commitCompletedDocument({
      db,
      document,
      signer,
      allSigners,
      at,
      ip,
      ua,
      appearances: built.appearances,
      claim: "sign",
    });
  }

  const [claimed] = await db
    .update(signersTable)
    .set({ signedAt: at, ip, ua })
    .where(
      and(
        eq(signersTable.id, signer.id),
        isNull(signersTable.signedAt),
        isNull(signersTable.declinedAt),
      ),
    )
    .returning();
  if (!claimed) {
    return jsonError(409, "Document is not awaiting signature", "invalid_state");
  }

  const inviteFail = await inviteNextHumanIfNeeded(
    db,
    document,
    allSigners,
    signer,
    at,
    async () => {
      await db
        .update(signersTable)
        .set({ signedAt: null, ip: signer.ip, ua: signer.ua })
        .where(eq(signersTable.id, signer.id));
    },
  );
  if (inviteFail) return inviteFail;

  await logEvent(db, {
    documentId: document.id,
    signerId: signer.id,
    event: "signed",
    ip: ip ?? undefined,
    ua: ua ?? undefined,
  });
  const completed = await completeIfAllPartiesDone({
    db,
    document,
    signer,
    at,
    ip,
    ua,
    currentPng,
    claim: "sign",
  });
  if (completed) return completed;
  try {
    await fireSignerCompletedWebhook(db, document, claimed, "pending");
  } catch {
    // delivery audits webhook_failed
  }

  return Response.json({ status: "pending" });
}

export async function getCeremonyPreview(
  _req: Request,
  token: string,
): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { db, signer, document } = loaded;
  const at = now();

  if (document.status === "deleted") {
    return jsonError(410, "This link has expired", "deleted");
  }
  if (!signer.signedAt && document.expiresAt.getTime() <= at.getTime()) {
    return jsonError(410, "This link has expired", "expired");
  }
  const wait = await sequentialWait(db, signer, document);
  if (wait && !signer.signedAt) return wait;
  if (document.status !== "pending") {
    return jsonError(409, "Document is not awaiting signature", "invalid_state");
  }

  const store = requireStore();
  if (!store) return storeUnavailableResponse();
  const original = await store.get(objectKey(document.id, "original"));
  if (!original) {
    return jsonError(500, "Original document missing", "missing_original");
  }
  return new Response(Buffer.from(original), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": "inline",
    },
  });
}

export async function getCeremonyPdf(req: Request, token: string): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { signer, document } = loaded;
  if (document.status === "deleted") {
    return jsonError(410, "Document has been deleted", "deleted");
  }
  if (!signer.signedAt && !signer.declinedAt) {
    return jsonError(409, "Document is not completed", "not_completed");
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

export async function postDecline(
  req: Request,
  token: string,
): Promise<Response> {
  const loaded = await loadSigner(token);
  if (!loaded.ok) return loaded.error;
  const { db, signer, document } = loaded;
  const at = now();
  const mailer = requireMailer();

  if (document.expiresAt.getTime() <= at.getTime() && document.status === "pending") {
    return jsonError(410, "This link has expired", "expired");
  }
  if (signer.signedAt) {
    return jsonError(409, "Already signed", "invalid_state");
  }
  if (document.status !== "pending") {
    return jsonError(409, "Document is not awaiting signature", "invalid_state");
  }
  const wait = await sequentialWait(db, signer, document);
  if (wait) return wait;

  let reason: string | undefined;
  try {
    const body: unknown = await req.json();
    if (
      body &&
      typeof body === "object" &&
      "reason" in body &&
      typeof (body as { reason: unknown }).reason === "string"
    ) {
      reason = (body as { reason: string }).reason;
    }
  } catch {
    // optional JSON body
  }

  const ip = clientIp(req);
  const ua = req.headers.get("user-agent") ?? undefined;
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(signersTable)
        .set({ declinedAt: at, ip, ua })
        .where(
          and(
            eq(signersTable.id, signer.id),
            isNull(signersTable.signedAt),
            isNull(signersTable.declinedAt),
          ),
        )
        .returning();
      if (!row) throw new Error("decline_conflict");
      const [envRow] = await tx
        .update(documents)
        .set({ status: "declined" })
        .where(and(eq(documents.id, document.id), eq(documents.status, "pending")))
        .returning();
      if (!envRow) throw new Error("decline_conflict");
    });
  } catch {
    return jsonError(409, "Document is not awaiting signature", "invalid_state");
  }
  await logEvent(db, {
    documentId: document.id,
    signerId: signer.id,
    event: "declined",
    ip,
    ua,
    payload: reason ? { reason } : undefined,
  });
  await fireAgentPartyWebhooks(db, document.id, {
    event: "document.declined",
    status: "declined",
  });
  try {
    const brand = await loadBrand(db, document.userId, requireStore());
    const body = declineEmail({
      signerName: signer.name,
      title: document.title,
      reason,
      senderEmail: document.senderEmail,
      brand: {
        displayName: brand.displayName,
        hasLogo: Boolean(brand.logoBytes),
      },
    });
    await mailer.sendMail({
      to: document.senderEmail,
      ...body,
      attachments: brandMailAttachments(brand.logoBytes),
    });
  } catch (err) {
    await logEvent(db, {
      documentId: document.id,
      signerId: signer.id,
      event: "emailed_failed",
      payload: { error: err instanceof Error ? err.message : "mail_failed" },
    });
  }
  return Response.json({ status: "declined" });
}
