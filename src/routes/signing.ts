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
import { completeDocumentPdf } from "../lib/pdf/complete.js";
import { loadSigningP12 } from "../lib/pdf/devP12.js";
import type { SignatureAppearance } from "../lib/pdf/appendSignaturePage.js";
import { appearanceKey, objectKey, type BlobStore } from "../lib/storage.js";
import { hashSigningToken, newSigningToken } from "../lib/tokens.js";
import {
  fireAgentPartyReady,
  fireAgentPartyWebhooks,
  fireDocumentCompleted,
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
): Promise<Response | null> {
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
      if (!currentPng) {
        return {
          ok: false,
          error: jsonError(500, "Prior signature missing", "missing_appearance"),
        };
      }
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
    if (!prior) {
      return {
        ok: false,
        error: jsonError(500, "Prior signature missing", "missing_appearance"),
      };
    }
    appearances.push({
      kind: "human",
      png: prior,
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

  let result: Awaited<ReturnType<typeof completeDocumentPdf>>;
  try {
    const { p12, passphrase } = signingP12();
    result = await completeDocumentPdf({
      original,
      appearances: pages,
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
    return jsonError(500, "Failed to complete document", "complete_failed");
  }
  await logEvent(db, {
    documentId: document.id,
    signerId: signer.id,
    event: claim === "sign" ? "signed" : "attested",
    ip: claim === "sign" ? ip ?? undefined : undefined,
    ua: claim === "sign" ? ua ?? undefined : undefined,
  });
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
    await fireDocumentCompleted(db, document, {
      event: "document.completed",
      id: document.id,
      status: "completed",
      sha256: result.sha256,
      shred_at: shredAt,
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

export async function inviteNextHumanIfNeeded(
  db: AuditDb,
  document: DocumentRow,
  allSigners: SignerRow[],
  current: SignerRow,
  at: Date,
  rollbackCurrent: () => Promise<void>,
): Promise<Response | null> {
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

  const mailer = requireMailer();
  const store = requireStore();
  let raw: string;
  if (next.tokenEnc) {
    raw = openWebhookSecret(next.tokenEnc);
  } else {
    const token = newSigningToken();
    raw = token.raw;
    const [slot] = await db
      .update(signersTable)
      .set({ tokenHash: token.hash, tokenEnc: sealWebhookSecret(token.raw) })
      .where(and(eq(signersTable.id, next.id), isNull(signersTable.sentAt)))
      .returning();
    if (!slot) return null;
  }
  const brand = await loadBrand(db, document.userId, store);
  const invite = inviteEmail({
    signUrl: publicSignUrl(raw),
    senderEmail: document.senderEmail,
    title: document.title,
    expiresAt: document.expiresAt,
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
    await db
      .update(signersTable)
      .set({ sentAt: at })
      .where(eq(signersTable.id, next.id));
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

  const wait = await sequentialWait(db, signer);
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
  const wait = await sequentialWait(db, signer);
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
  const wait = await sequentialWait(db, signer);
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
  const file = form.get("png");
  if (!(file instanceof Blob)) {
    return jsonError(400, "A PNG signature is required", "invalid_png");
  }
  const png = new Uint8Array(await file.arrayBuffer());
  if (png.byteLength > 1_000_000 || !isPng(png)) {
    return jsonError(400, "A PNG signature is required", "invalid_png");
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
      png,
    );
    if (!built.ok) return built.error;
    await store.put(appearanceKey(document.id, signer.id), png);
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

  await store.put(appearanceKey(document.id, signer.id), png);

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

  return Response.json({ status: "pending" });
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
  const wait = await sequentialWait(db, signer);
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
