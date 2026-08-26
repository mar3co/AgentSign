import { createHmac, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { POST as postAgents } from "../../app/v1/agents/route.js";
import { POST as postAttest } from "../../app/v1/documents/[id]/attest/route.js";
import { POST as postReject } from "../../app/v1/documents/[id]/reject/route.js";
import { POST as postDocument } from "../../app/v1/documents/route.js";
import { GET as getDocument } from "../../app/v1/documents/[id]/route.js";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import {
  accounts,
  auditEvents,
  files,
  documents,
  signers as signersTable,
} from "../db/schema.js";
import { resetEnvCache } from "../env.js";
import { resetDeps, setDeps } from "../lib/deps.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { inviteNextHumanIfNeeded } from "../routes/signing.js";
import { createFsStore } from "../lib/storage.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

type AuthUser = { id: string; email: string };

function createFakeAuth() {
  const users = new Map<string, AuthUser>();
  const sessions = new Map<string, AuthUser>();
  const codes = new Map<string, AuthUser>();

  function userFor(email: string): AuthUser {
    const e = email.toLowerCase();
    let u = users.get(e);
    if (!u) {
      u = { id: randomUUID(), email: e };
      users.set(e, u);
    }
    return u;
  }

  return {
    userFor,
    adapter: {
      async sendMagicLink({ email }: { email: string }) {
        const u = userFor(email);
        codes.set(`magic:${u.email}`, u);
      },
      async signInWithPassword() {
        return {
          ok: false as const,
          error: "Invalid credentials",
          code: "invalid_credentials",
        };
      },
      async signUp() {
        return { ok: true as const };
      },
      async startOAuth({
        redirectTo,
      }: {
        provider: "google" | "github";
        redirectTo: string;
      }) {
        return { url: redirectTo };
      },
      async userFromCookie(header: string | null) {
        if (!header) return null;
        const m = header.match(/(?:^|;\s*)sign_session=([^;]+)/);
        if (!m) return null;
        return sessions.get(m[1]!) ?? null;
      },
      async exchangeCode(code: string) {
        const u = codes.get(code);
        if (!u) return null;
        const token = randomUUID();
        sessions.set(token, u);
        return {
          user: u,
          cookie: `sign_session=${token}; Path=/; HttpOnly`,
        };
      },
    },
  };
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

async function magicCookie(email: string) {
  const login = await postLogin(
    new Request("http://sign.test/login/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  expect(login.status).toBe(200);
  const cb = await getAuthCallback(
    new Request(
      `http://sign.test/auth/callback?code=${encodeURIComponent(`magic:${email.toLowerCase()}`)}`,
    ),
  );
  expect(cb.status).toBe(302);
  return cookieFrom(cb);
}

async function boot() {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const sent: { to: string; subject: string; text: string }[] = [];
  const { adapter, userFor } = createFakeAuth();
  setDeps({
    db,
    store,
    auth: adapter,
    mailer: {
      sendMail: async (m) => {
        sent.push(m);
      },
    },
    p12: makeDevP12("test"),
    p12Passphrase: "test",
  });
  return { db, store, sent, userFor };
}

async function asPro(
  db: Awaited<ReturnType<typeof createTestDb>>,
  userFor: (email: string) => AuthUser,
  email = "shop@example.com",
) {
  const cookie = await magicCookie(email);
  const userId = userFor(email).id;
  await db
    .update(accounts)
    .set({ plan: "pro" })
    .where(eq(accounts.userId, userId));
  return { cookie, userId };
}

async function mintLive(cookie: string) {
  const minted = await postKeys(
    new Request("http://sign.test/v1/keys", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    }),
  );
  expect(minted.status).toBe(201);
  const { key } = (await minted.json()) as { key: string };
  expect(key).toMatch(/^sign_live_/);
  return key;
}

async function createNamedAgent(
  cookie: string,
  slug: string,
  name: string,
  webhookUrl?: string,
) {
  const res = await postAgents(
    new Request("http://sign.test/v1/agents", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        slug,
        name,
        ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
      }),
    }),
  );
  expect(res.status).toBe(201);
  const json = (await res.json()) as {
    id: string;
    slug: string;
    key: string;
    webhook_secret?: string;
  };
  expect(json.key).toMatch(/^sign_agent_/);
  return json;
}

async function documentBody(
  signers: unknown,
  sender = "shop@example.com",
  webhookUrl?: string,
) {
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", "Repair authorization");
  body.set("sender_email", sender);
  body.set("signers", JSON.stringify(signers));
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  if (webhookUrl) body.set("webhook_url", webhookUrl);
  return body;
}

async function sendDocument(liveKey: string, signers: unknown, webhookUrl?: string) {
  const res = await postDocument(
    new Request("http://sign.test/v1/documents", {
      method: "POST",
      headers: { authorization: `Bearer ${liveKey}` },
      body: await documentBody(signers, "shop@example.com", webhookUrl),
    }),
  );
  expect(res.status).toBe(201);
  const created = (await res.json()) as {
    id: string;
    status: string;
    webhook_secret?: string;
  };
  expect(created.status).toBe("pending");
  return created.id;
}

function attestReq(id: string, key: string, body?: unknown) {
  return new Request(`http://sign.test/v1/documents/${id}/attest`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function envCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function tokenFromUrl(signUrl: string) {
  return signUrl.replace(/^\/s\//, "");
}

afterEach(() => {
  delete process.env.SIGN_FLAG_AGENT_PARTIES;
  delete process.env.SIGN_FLAG_AGENT_ONLY_ATTEST;
  resetEnvCache();
  resetDeps();
});

describe("POST /v1/documents/:id/attest", () => {
  it("agent key attests current agent party", { timeout: 60_000 }, async () => {
    const { db, sent, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const agent = await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const live = await mintLive(cookie);
    const id = await sendDocument(live, [
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
      },
      { name: "Jane", email: "jane@example.com" },
    ]);

    const beforeMail = sent.length;
    const res = await postAttest(attestReq(id, agent.key), envCtx(id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("pending");

    const rows = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, id));
    rows.sort((a, b) => a.signingOrder - b.signingOrder);
    expect(rows[0]!.kind).toBe("agent");
    expect(rows[0]!.attestedAt).not.toBeNull();
    expect(rows[0]!.signedAt).toBeNull();
    expect(rows[0]!.rejectedAt).toBeNull();
    expect(rows[0]!.attestMethod).toBe("agent_key");
    expect(rows[1]!.signedAt).toBeNull();
    expect(rows[1]!.attestedAt).toBeNull();
    expect(rows[1]!.kind).toBe("human");
    expect(rows[1]!.tokenHash).toBeTruthy();
    expect(rows[1]!.sentAt).not.toBeNull();

    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("pending");

    const status = await getDocument(
      new Request(`http://sign.test/v1/documents/${id}`, {
        headers: { authorization: `Bearer ${live}` },
      }),
      envCtx(id),
    );
    expect(status.status).toBe(200);
    const got = (await status.json()) as {
      current_party: { index: number; kind: string; email: string } | null;
    };
    expect(got.current_party).toEqual({
      index: 1,
      kind: "human",
      email: "jane@example.com",
    });

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.documentId, id));
    expect(audit.some((a) => a.event === "attested")).toBe(true);

    const afterMail = sent.slice(beforeMail);
    expect(afterMail.some((m) => m.to === "jane@example.com")).toBe(true);
  });

  it("sign_live_ cannot attest without naming an allowed agent", { timeout: 60_000 }, async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const live = await mintLive(cookie);
    const id = await sendDocument(live, [
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
      },
      { name: "Jane", email: "jane@example.com" },
    ]);

    const res = await postAttest(attestReq(id, live, {}), envCtx(id));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.code).toBe("cannot_attest");
    expect(json.error).toBeTruthy();

    const [row] = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, id));
    expect(row!.attestedAt).toBeNull();

    const named = await postAttest(
      attestReq(id, live, { agent: "grok-legal" }),
      envCtx(id),
    );
    expect(named.status).toBe(200);
  });

  it("A→A last attest with flag off is 400 human_required and not completed", {
    timeout: 60_000,
  }, async () => {
    const { db, store, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const first = await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const second = await createNamedAgent(cookie, "grok-ops", "Grok Ops");
    const live = await mintLive(cookie);
    const id = await sendDocument(live, [
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
      },
      {
        name: "Grok Ops",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-ops",
      },
    ]);

    const a1 = await postAttest(attestReq(id, first.key), envCtx(id));
    expect(a1.status).toBe(200);

    const a2 = await postAttest(attestReq(id, second.key), envCtx(id));
    expect(a2.status).toBe(400);
    const json = (await a2.json()) as { error: string; code: string };
    expect(json.code).toBe("human_required");
    expect(json.error).toBeTruthy();

    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("pending");
    const docs = await db.select().from(files).where(eq(files.documentId, id));
    expect(docs.some((d) => d.kind === "sealed")).toBe(false);
    expect(await store.get(`${id}/sealed.pdf`)).toBeNull();

    const rows = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, id));
    rows.sort((a, b) => a.signingOrder - b.signingOrder);
    expect(rows[0]!.attestedAt).not.toBeNull();
    expect(rows[1]!.attestedAt).not.toBeNull();
    expect(rows.every((s) => s.signedAt === null)).toBe(true);
  });

  it("A→A with SIGN_FLAG_AGENT_ONLY_ATTEST=1 completes", { timeout: 60_000 }, async () => {
    process.env.SIGN_FLAG_AGENT_ONLY_ATTEST = "1";
    resetEnvCache();

    const { db, store, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const first = await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const second = await createNamedAgent(cookie, "grok-ops", "Grok Ops");
    const live = await mintLive(cookie);
    const id = await sendDocument(live, [
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
      },
      {
        name: "Grok Ops",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-ops",
      },
    ]);

    expect((await postAttest(attestReq(id, first.key), envCtx(id))).status).toBe(200);
    const last = await postAttest(attestReq(id, second.key), envCtx(id));
    expect(last.status).toBe(200);
    const json = (await last.json()) as { status: string; sha256?: string };
    expect(json.status).toBe("completed");
    expect(json.sha256).toBeTruthy();

    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("completed");
    expect(env!.sha256).toBe(json.sha256);
    expect(await store.get(`${id}/sealed.pdf`)).not.toBeNull();
    const docs = await db.select().from(files).where(eq(files.documentId, id));
    expect(docs.some((d) => d.kind === "sealed")).toBe(true);
    const sealed = await store.get(`${id}/sealed.pdf`);
    const cert = await store.get(`${id}/certificate.pdf`);
    const banner = "No human electronic signature. Agent attestations only.";
    expect(Buffer.from(sealed!).toString("latin1")).toContain(banner);
    expect(Buffer.from(cert!).toString("latin1")).toContain(banner);
    expect(Buffer.from(cert!).toString("latin1")).toContain("human_signatures: 0");
    expect(Buffer.from(cert!).toString("latin1")).not.toContain("Sent with AgentSign");
  });

  it("concurrent double attest: one 200 one 409", { timeout: 60_000 }, async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const agent = await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const live = await mintLive(cookie);
    const id = await sendDocument(live, [
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
      },
      { name: "Jane", email: "jane@example.com" },
    ]);

    const [a, b] = await Promise.all([
      postAttest(attestReq(id, agent.key), envCtx(id)),
      postAttest(attestReq(id, agent.key), envCtx(id)),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);

    const rows = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, id));
    rows.sort((x, y) => x.signingOrder - y.signingOrder);
    expect(rows[0]!.attestedAt).not.toBeNull();
  });

  it("A→H: agent attest then last human Finish seals", { timeout: 60_000 }, async () => {
    const { db, store, sent, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const agent = await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const live = await mintLive(cookie);
    const id = await sendDocument(live, [
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
      },
      { name: "Jane", email: "jane@example.com" },
    ]);

    expect((await postAttest(attestReq(id, agent.key), envCtx(id))).status).toBe(200);
    const invite = sent.find((m) => m.to === "jane@example.com");
    expect(invite).toBeTruthy();
    const token = tokenFromUrl(invite!.text.match(/\/s\/([A-Za-z0-9_-]+)/)![1]!);

    const consent = await postConsent(
      new Request(`http://sign.test/s/${token}/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(consent.status).toBe(200);

    const body = new FormData();
    body.set("png", new Blob([png], { type: "image/png" }), "sig.png");
    const sign = await postSign(
      new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body }),
      { params: Promise.resolve({ token }) },
    );
    expect(sign.status).toBe(200);
    const json = (await sign.json()) as { status: string; sha256?: string };
    expect(json.status).toBe("completed");
    expect(json.sha256).toBeTruthy();

    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("completed");
    expect(await store.get(`${id}/sealed.pdf`)).not.toBeNull();
  });

  it("concurrent last-human Finish vs agent attest: CAS, one winner", {
    timeout: 60_000,
  }, async () => {
    const { db, store, sent, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const agent = await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const live = await mintLive(cookie);
    const id = await sendDocument(live, [
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
      },
      { name: "Jane", email: "jane@example.com" },
    ]);

    expect((await postAttest(attestReq(id, agent.key), envCtx(id))).status).toBe(200);
    const invite = sent.find((m) => m.to === "jane@example.com");
    expect(invite).toBeTruthy();
    const token = tokenFromUrl(invite!.text.match(/\/s\/([A-Za-z0-9_-]+)/)![1]!);

    expect(
      (
        await postConsent(
          new Request(`http://sign.test/s/${token}/consent`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ consent: true }),
          }),
          { params: Promise.resolve({ token }) },
        )
      ).status,
    ).toBe(200);

    const body = new FormData();
    body.set("png", new Blob([png], { type: "image/png" }), "sig.png");
    const [finish, attest] = await Promise.all([
      postSign(
        new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body }),
        { params: Promise.resolve({ token }) },
      ),
      postAttest(attestReq(id, agent.key), envCtx(id)),
    ]);
    const statuses = [finish.status, attest.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 409]);
    expect(finish.status).toBe(200);
    expect(attest.status).toBe(409);

    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("completed");
    expect(await store.get(`${id}/sealed.pdf`)).not.toBeNull();

    const parties = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, id));
    parties.sort((a, b) => a.signingOrder - b.signingOrder);
    expect(parties[0]!.attestedAt).not.toBeNull();
    expect(parties[1]!.signedAt).not.toBeNull();
  });

  it("agent key reject declines the document", { timeout: 60_000 }, async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const agent = await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const live = await mintLive(cookie);
    const id = await sendDocument(live, [
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
      },
      { name: "Jane", email: "jane@example.com" },
    ]);

    const res = await postReject(
      new Request(`http://sign.test/v1/documents/${id}/reject`, {
        method: "POST",
        headers: { authorization: `Bearer ${agent.key}` },
      }),
      envCtx(id),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string }).toEqual({ status: "declined" });

    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("declined");
    const rows = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, id));
    rows.sort((a, b) => a.signingOrder - b.signingOrder);
    expect(rows[0]!.kind).toBe("agent");
    expect(rows[0]!.rejectedAt).not.toBeNull();
    expect(rows[0]!.attestedAt).toBeNull();
    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.documentId, id));
    expect(audit.some((a) => a.event === "rejected")).toBe(true);
  });

  it("next-human invite mail throw rolls back attestedAt and does not audit attested", {
    timeout: 60_000,
  }, async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const agent = await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const live = await mintLive(cookie);
    const id = await sendDocument(live, [
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
      },
      { name: "Jane", email: "jane@example.com" },
    ]);

    setDeps({
      mailer: {
        sendMail: async (m) => {
          if (/please sign/i.test(m.subject) && /jane@example.com/i.test(m.to)) {
            throw new Error("resend down");
          }
        },
      },
    });

    const res = await postAttest(attestReq(id, agent.key), envCtx(id));
    expect(res.status).toBe(503);

    const rows = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, id));
    rows.sort((a, b) => a.signingOrder - b.signingOrder);
    expect(rows[0]!.attestedAt).toBeNull();
    expect(rows[1]!.sentAt).toBeNull();

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.documentId, id));
    expect(audit.some((a) => a.event === "attested")).toBe(false);
  });

  it("agent party.ready HMAC verifies and document.completed still fires", {
    timeout: 60_000,
  }, async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    const posts: { url: string; init: RequestInit }[] = [];
    function hdr(init: RequestInit, name: string): string | null {
      const h = init.headers;
      if (!h) return null;
      if (h instanceof Headers) return h.get(name);
      if (Array.isArray(h)) {
        const row = h.find(([k]) => k.toLowerCase() === name.toLowerCase());
        return row?.[1] ?? null;
      }
      const rec = h as Record<string, string>;
      const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
      return key ? rec[key]! : null;
    }

    const { db, sent, userFor } = await boot();
    setDeps({
      now: () => frozen,
      fetch: async (input, init) => {
        posts.push({ url: String(input), init: init ?? {} });
        return new Response("ok", { status: 200 });
      },
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    const { cookie } = await asPro(db, userFor);
    const agent = await createNamedAgent(
      cookie,
      "grok-legal",
      "Grok Legal",
      "https://example.com/agent-hook",
    );
    expect(agent.webhook_secret).toBeTruthy();
    const live = await mintLive(cookie);
    const createRes = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${live}` },
        body: await documentBody(
          [
            {
              name: "Grok Legal",
              email: "shop@example.com",
              kind: "agent",
              agent: "grok-legal",
            },
            { name: "Jane", email: "jane@example.com" },
          ],
          "shop@example.com",
          "https://example.com/env-hook",
        ),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      webhook_secret?: string;
    };
    expect(created.webhook_secret).toBeTruthy();

    const ready = posts.filter((p) => p.url === "https://example.com/agent-hook");
    expect(ready).toHaveLength(1);
    const readyBody = String(ready[0]!.init.body);
    const readyPayload = JSON.parse(readyBody) as Record<string, unknown>;
    expect(readyPayload).toEqual({
      event: "party.ready",
      id: created.id,
      agent: "grok-legal",
      status: "pending",
    });
    expect(readyBody).not.toContain(agent.key);
    expect(readyBody).not.toContain(agent.webhook_secret);
    expect(readyBody).not.toContain(created.webhook_secret);
    expect(readyBody).not.toMatch(/sign_agent_/);
    const readyTs = hdr(ready[0]!.init, "X-Sign-Timestamp");
    const readySig = hdr(ready[0]!.init, "X-Sign-Signature");
    const readyExpected = createHmac("sha256", agent.webhook_secret!)
      .update(`${readyTs}.${readyBody}`)
      .digest("hex");
    expect(readySig).toBe(`sha256=${readyExpected}`);

    expect((await postAttest(attestReq(created.id, agent.key), envCtx(created.id))).status).toBe(
      200,
    );
    const invite = sent.find((m) => m.to === "jane@example.com");
    expect(invite).toBeTruthy();
    const token = tokenFromUrl(invite!.text.match(/\/s\/([A-Za-z0-9_-]+)/)![1]!);
    expect(
      (
        await postConsent(
          new Request(`http://sign.test/s/${token}/consent`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ consent: true }),
          }),
          { params: Promise.resolve({ token }) },
        )
      ).status,
    ).toBe(200);
    const pngBody = new FormData();
    pngBody.set("png", new Blob([png], { type: "image/png" }), "sig.png");
    const sign = await postSign(
      new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body: pngBody }),
      { params: Promise.resolve({ token }) },
    );
    expect(sign.status).toBe(200);

    const agentDone = posts.filter(
      (p) =>
        p.url === "https://example.com/agent-hook" &&
        String(p.init.body).includes("document.completed"),
    );
    expect(agentDone).toHaveLength(1);
    const agentDonePayload = JSON.parse(String(agentDone[0]!.init.body)) as Record<
      string,
      unknown
    >;
    expect(agentDonePayload.event).toBe("document.completed");
    expect(agentDonePayload.id).toBe(created.id);
    expect(agentDonePayload.agent).toBe("grok-legal");
    expect(agentDonePayload.status).toBe("completed");
    expect("sha256" in agentDonePayload).toBe(false);
    expect(String(agentDone[0]!.init.body)).not.toContain(agent.key);

    const envDone = posts.filter(
      (p) =>
        p.url === "https://example.com/env-hook" &&
        String(p.init.body).includes("document.completed"),
    );
    expect(envDone).toHaveLength(1);
    const envPayload = JSON.parse(String(envDone[0]!.init.body)) as Record<string, unknown>;
    expect(envPayload.event).toBe("document.completed");
    expect(envPayload.id).toBe(created.id);
    expect(envPayload.status).toBe("completed");
    expect(envPayload.sha256).toBeTruthy();
    const envTs = hdr(envDone[0]!.init, "X-Sign-Timestamp");
    const envSig = hdr(envDone[0]!.init, "X-Sign-Signature");
    const envExpected = createHmac("sha256", created.webhook_secret!)
      .update(`${envTs}.${String(envDone[0]!.init.body)}`)
      .digest("hex");
    expect(envSig).toBe(`sha256=${envExpected}`);
    expect(
      posts.some(
        (p) =>
          p.url === "https://example.com/env-hook" &&
          String(p.init.body).includes("signer.completed"),
      ),
    ).toBe(true);
  });

  it("inviteNextHumanIfNeeded does not email when document is not pending", {
    timeout: 60_000,
  }, async () => {
    const { db, sent, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const live = await mintLive(cookie);
    const id = await sendDocument(live, [
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
      },
      { name: "Jane", email: "jane@example.com" },
    ]);
    const allSigners = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, id));
    allSigners.sort((a, b) => a.signingOrder - b.signingOrder);
    const [document] = await db.select().from(documents).where(eq(documents.id, id));
    await db
      .update(documents)
      .set({ status: "deleted" })
      .where(eq(documents.id, id));
    const before = sent.length;
    const fail = await inviteNextHumanIfNeeded(
      db,
      document!,
      allSigners,
      allSigners[0]!,
      new Date(),
      async () => {},
    );
    expect(fail?.status).toBe(409);
    expect(sent.length).toBe(before);
    const [human] = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.id, allSigners[1]!.id));
    expect(human!.sentAt).toBeNull();
  });
});


