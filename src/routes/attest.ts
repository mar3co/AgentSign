import { and, eq, isNull } from "drizzle-orm";
import { agents, documents, signers as signersTable } from "../db/schema.js";
import { loadActiveAgentBySlug, parseAgentSlug, type AgentRow } from "../lib/agents.js";
import { logEvent, type AuditDb } from "../lib/audit.js";
import { teamForUser } from "../lib/team.js";
import { requireCaller, type CallerOk } from "../lib/caller.js";
import { getDeps, storeUnavailableResponse } from "../lib/deps.js";
import { flagOn } from "../lib/flags.js";
import type { BlobStore } from "../lib/storage.js";
import { fireAgentPartyWebhooks } from "../lib/webhooks.js";
import {
  buildCompleteAppearances,
  commitCompletedDocument,
  fireSignerCompletedWebhook,
  inviteNextHumanIfNeeded,
  partyDone,
  type DocumentRow,
  type SignerRow,
} from "./signing.js";

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function requireStore(): BlobStore | null {
  return getDeps().store ?? null;
}

function now(): Date {
  return getDeps().now?.() ?? new Date();
}

async function readJson(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

type LoadedDocument =
  | {
      ok: true;
      db: AuditDb;
      caller: CallerOk;
      document: DocumentRow;
      allSigners: SignerRow[];
      party: SignerRow;
      agent: AgentRow;
      attestMethod: "agent_key" | "oauth" | null;
      attestLabel: string | null;
    }
  | { ok: false; error: Response };

async function resolveAttestAgent(
  db: AuditDb,
  caller: CallerOk,
  document: DocumentRow,
  body: unknown,
): Promise<
  | {
      ok: true;
      agent: AgentRow;
      attestMethod: "agent_key" | "oauth" | null;
      attestLabel: string | null;
    }
  | { ok: false; error: Response }
> {
  if (!document.userId) {
    return { ok: false, error: jsonError(403, "Cannot attest this document", "cannot_attest") };
  }
  const team = await teamForUser(db, document.userId);
  if (!team.entitled) {
    return { ok: false, error: jsonError(403, "Pro plan required", "pro_required") };
  }
  if (!team.memberUserIds.includes(caller.user.id) && caller.via !== "agent") {
    return { ok: false, error: jsonError(403, "Cannot attest this document", "cannot_attest") };
  }

  if (caller.via === "agent") {
    if (!caller.agentId) {
      return { ok: false, error: jsonError(403, "Cannot attest this document", "cannot_attest") };
    }
    const [agent] = await db.select().from(agents).where(eq(agents.id, caller.agentId));
    if (!agent || agent.revokedAt || agent.ownerUserId !== team.ownerUserId) {
      return { ok: false, error: jsonError(403, "Cannot attest this document", "cannot_attest") };
    }
    return {
      ok: true,
      agent,
      attestMethod: "agent_key",
      attestLabel: caller.keyPrefix ? `agent_key:${caller.keyPrefix}` : null,
    };
  }

  if (caller.via === "oauth") {
    if (!caller.allowedAgentIds?.length) {
      return { ok: false, error: jsonError(403, "Cannot attest this document", "cannot_attest") };
    }
    const slug =
      body && typeof body === "object" && !Array.isArray(body)
        ? parseAgentSlug((body as { agent?: unknown }).agent)
        : null;
    if (!slug) {
      return {
        ok: false,
        error: jsonError(403, "Name an allowed agent to attest", "cannot_attest"),
      };
    }
    const agent = await loadActiveAgentBySlug(db, team.ownerUserId, slug);
    if (!agent || !caller.allowedAgentIds.includes(agent.id)) {
      return { ok: false, error: jsonError(403, "Cannot attest this document", "cannot_attest") };
    }
    if (!team.memberUserIds.includes(caller.user.id)) {
      return { ok: false, error: jsonError(403, "Cannot attest this document", "cannot_attest") };
    }
    return {
      ok: true,
      agent,
      attestMethod: "oauth",
      attestLabel: caller.oauthClientName ? `oauth:${caller.oauthClientName}` : "oauth",
    };
  }

  const slug =
    body && typeof body === "object" && !Array.isArray(body)
      ? parseAgentSlug((body as { agent?: unknown }).agent)
      : null;
  if (!slug) {
    return {
      ok: false,
      error: jsonError(403, "Name an allowed agent to attest", "cannot_attest"),
    };
  }
  const agent = await loadActiveAgentBySlug(db, team.ownerUserId, slug);
  if (!agent) {
    return { ok: false, error: jsonError(403, "Cannot attest this document", "cannot_attest") };
  }
  if (!team.memberUserIds.includes(caller.user.id)) {
    return { ok: false, error: jsonError(403, "Cannot attest this document", "cannot_attest") };
  }
  return { ok: true, agent, attestMethod: null, attestLabel: caller.via };
}

async function loadAttestContext(req: Request, documentId: string): Promise<LoadedDocument> {
  if (!documentId) {
    return { ok: false, error: jsonError(400, "Document id is required", "invalid_request") };
  }
  const caller = await requireCaller(req, { allowAgent: true });
  if (!caller.ok) return { ok: false, error: caller.response };
  if (!(await flagOn("agent_parties"))) {
    return { ok: false, error: jsonError(403, "Agent parties are disabled", "flag_off") };
  }

  const db = caller.db;
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!document) {
    return { ok: false, error: jsonError(404, "Document not found", "not_found") };
  }
  const at = now();
  if (document.status === "deleted") {
    return { ok: false, error: jsonError(410, "This link has expired", "deleted") };
  }
  if (document.expiresAt.getTime() <= at.getTime() && document.status === "pending") {
    return { ok: false, error: jsonError(410, "This link has expired", "expired") };
  }
  if (document.status !== "pending") {
    return {
      ok: false,
      error: jsonError(409, "Document is not awaiting attestation", "invalid_state"),
    };
  }

  const body = await readJson(req);
  const named = await resolveAttestAgent(db, caller, document, body);
  if (!named.ok) return named;

  const allSigners = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.documentId, document.id));
  allSigners.sort((a, b) => a.signingOrder - b.signingOrder);
  const current = allSigners.find((s) => !partyDone(s));
  if (!current || current.kind !== "agent") {
    return {
      ok: false,
      error: jsonError(409, "Document is not awaiting attestation", "invalid_state"),
    };
  }
  if (current.agentId !== named.agent.id) {
    return {
      ok: false,
      error: jsonError(403, "Cannot attest this document", "cannot_attest"),
    };
  }

  return {
    ok: true,
    db,
    caller,
    document,
    allSigners,
    party: current,
    agent: named.agent,
    attestMethod: named.attestMethod,
    attestLabel: named.attestLabel,
  };
}

export async function attestDocument(req: Request, documentId: string): Promise<Response> {
  const loaded = await loadAttestContext(req, documentId);
  if (!loaded.ok) return loaded.error;
  const { db, document, allSigners, party, attestMethod, attestLabel } = loaded;
  const at = now();

  const last = allSigners.every((s) => s.id === party.id || partyDone(s));
  const anySigned = allSigners.some((s) => s.signedAt);
  const allowAgentOnly = await flagOn("agent_only_attest");

  if (last && (anySigned || allowAgentOnly)) {
    const store = requireStore();
    if (!store) return storeUnavailableResponse();
    const built = await buildCompleteAppearances(
      store,
      document.id,
      allSigners,
      party.id,
      at,
      undefined,
      (document.fields ?? []).length === 0,
    );
    if (!built.ok) return built.error;
    return commitCompletedDocument({
      db,
      document,
      signer: party,
      allSigners,
      at,
      ip: null,
      ua: null,
      appearances: built.appearances,
      claim: "attest",
      attestMethod,
      attestLabel,
    });
  }

  let claimed: SignerRow | undefined;
  try {
    await db.transaction(async (tx) => {
      const [env] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, document.id), eq(documents.status, "pending")));
      if (!env) throw new Error("attest_conflict");
      const [row] = await tx
        .update(signersTable)
        .set({
          attestedAt: at,
          attestMethod,
          attestLabel,
        })
        .where(
          and(
            eq(signersTable.id, party.id),
            eq(signersTable.kind, "agent"),
            isNull(signersTable.attestedAt),
            isNull(signersTable.rejectedAt),
          ),
        )
        .returning();
      if (!row) throw new Error("attest_conflict");
      claimed = row;
    });
  } catch {
    return jsonError(409, "Document is not awaiting attestation", "invalid_state");
  }
  if (!claimed) {
    return jsonError(409, "Document is not awaiting attestation", "invalid_state");
  }

  if (last && !anySigned && !allowAgentOnly) {
    await logEvent(db, {
      documentId: document.id,
      signerId: party.id,
      event: "attested",
    });
    return jsonError(
      400,
      "A human electronic signature is required to complete this document",
      "human_required",
    );
  }

  const inviteFail = await inviteNextHumanIfNeeded(
    db,
    document,
    allSigners,
    party,
    at,
    async () => {
      await db
        .update(signersTable)
        .set({ attestedAt: null, attestMethod: null, attestLabel: null })
        .where(eq(signersTable.id, party.id));
    },
  );
  if (inviteFail) return inviteFail;

  await logEvent(db, {
    documentId: document.id,
    signerId: party.id,
    event: "attested",
  });
  try {
    await fireSignerCompletedWebhook(db, document, claimed, "pending");
  } catch {
    // delivery audits webhook_failed
  }

  return Response.json({ status: "pending" });
}

export async function rejectDocument(req: Request, documentId: string): Promise<Response> {
  const loaded = await loadAttestContext(req, documentId);
  if (!loaded.ok) return loaded.error;
  const { db, document, party } = loaded;
  const at = now();

  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(signersTable)
        .set({ rejectedAt: at })
        .where(
          and(
            eq(signersTable.id, party.id),
            eq(signersTable.kind, "agent"),
            isNull(signersTable.attestedAt),
            isNull(signersTable.rejectedAt),
          ),
        )
        .returning();
      if (!row) throw new Error("reject_conflict");
      const [envRow] = await tx
        .update(documents)
        .set({ status: "declined" })
        .where(and(eq(documents.id, document.id), eq(documents.status, "pending")))
        .returning();
      if (!envRow) throw new Error("reject_conflict");
    });
  } catch {
    return jsonError(409, "Document is not awaiting attestation", "invalid_state");
  }

  await logEvent(db, {
    documentId: document.id,
    signerId: party.id,
    event: "rejected",
  });
  await fireAgentPartyWebhooks(db, document.id, {
    event: "document.declined",
    status: "declined",
  });
  return Response.json({ status: "declined" });
}
