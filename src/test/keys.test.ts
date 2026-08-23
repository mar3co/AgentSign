import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import { GET as listDocuments, POST as postDocument } from "../../app/v1/documents/route.js";
import { POST as postOtp } from "../../app/v1/documents/[id]/otp/route.js";
import { DELETE as deleteDocument, GET as getDocument } from "../../app/v1/documents/[id]/route.js";
import { GET as getPdf } from "../../app/v1/documents/[id]/pdf/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { accounts, apiKeys, documents } from "../db/schema.js";
import { setDeps } from "../lib/deps.js";
import { extendKeep } from "../lib/keys.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { createFsStore } from "../lib/storage.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

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

async function documentForm(sender = "shop@example.com") {
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", "Repair authorization");
  body.set("sender_email", sender);
  body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  return body;
}

describe("live keys", () => {
  it("magic login mints a live key that sends pending with no OTP, lists, and does not complete", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const { adapter, userFor } = createFakeAuth();
    setDeps({
      db,
      store,
      auth: adapter,
      mailer: { sendMail: async (m) => { sent.push(m); } },
    });

    const cookie = await magicCookie("shop@example.com");
    const minted = await postKeys(
      new Request("http://sign.test/v1/keys", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ expires_in_days: 30 }),
      }),
    );
    expect(minted.status).toBe(201);
    const keyJson = (await minted.json()) as { key: string; prefix: string };
    expect(keyJson.key).toMatch(/^sign_live_/);
    expect(keyJson.prefix).toBe(keyJson.key.slice(0, 12));
    const stored = await db.select().from(apiKeys);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.kind).toBe("live");
    expect(stored[0]!.userId).toBe(userFor("shop@example.com").id);
    expect(stored[0]!.documentId).toBeNull();
    expect(JSON.stringify(stored)).not.toContain(keyJson.key);

    const beforeMail = sent.length;
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${keyJson.key}` },
        body: await documentForm(),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      status: string;
      signers?: { sign_url?: string }[];
    };
    expect(created.status).toBe("pending");
    expect(created.signers?.[0]?.sign_url).toMatch(/^\/s\//);
    const otpMails = sent.slice(beforeMail).filter((m) =>
      /verification code/i.test(m.subject),
    );
    expect(otpMails).toHaveLength(0);
    expect(sent.slice(beforeMail).some((m) => /please sign/i.test(m.subject))).toBe(
      true,
    );

    const [row] = await db.select().from(documents).where(eq(documents.id, created.id));
    expect(row!.status).toBe("pending");
    expect(row!.userId).toBe(userFor("shop@example.com").id);

    const listed = await listDocuments(
      new Request("http://sign.test/v1/documents", {
        headers: { authorization: `Bearer ${keyJson.key}` },
      }),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { documents: { id: string; status: string }[] };
    expect(body.documents.some((e) => e.id === created.id)).toBe(true);

    const sessionList = await listDocuments(
      new Request("http://sign.test/v1/documents", { headers: { cookie } }),
    );
    expect(sessionList.status).toBe(200);

    const queryKey = await listDocuments(
      new Request(`http://sign.test/v1/documents?apiKey=${keyJson.key}`),
    );
    expect(queryKey.status).toBe(401);
    const qerr = (await queryKey.json()) as { error: string; code: string };
    expect(qerr.error).toBeTruthy();
    expect(qerr.code).toBeTruthy();
    expect(body.documents.find((e) => e.id === created.id)).toMatchObject({
      can_delete: true,
    });
  });

  it("live-key send binds sender_email to the account", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const { adapter, userFor } = createFakeAuth();
    setDeps({
      db,
      store,
      auth: adapter,
      mailer: { sendMail: async (m) => { sent.push(m); } },
    });
    const cookie = await magicCookie("shop@example.com");
    const minted = await postKeys(
      new Request("http://sign.test/v1/keys", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      }),
    );
    const { key } = (await minted.json()) as { key: string };
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: await documentForm("impostor@example.com"),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };
    const [row] = await db.select().from(documents).where(eq(documents.id, created.id));
    expect(row!.senderEmail).toBe("shop@example.com");
    expect(row!.userId).toBe(userFor("shop@example.com").id);
    expect(sent.some((m) => m.text.includes("impostor@example.com"))).toBe(false);
    expect(sent.some((m) => /shop@example.com asked you to sign/i.test(m.text))).toBe(true);
  });

  it("claiming attaches a prior one-off with the same sender_email", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const { adapter, userFor } = createFakeAuth();
    setDeps({
      db,
      store,
      auth: adapter,
      mailer: { sendMail: async (m) => { sent.push(m); } },
    });
    const created = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        body: await documentForm("shop@example.com"),
      }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const [before] = await db.select().from(documents).where(eq(documents.id, id));
    expect(before!.userId).toBeNull();

    const otherId = randomUUID();
    await db.insert(documents).values({
      id: otherId,
      title: "Someone else's",
      senderEmail: "shop@example.com",
      status: "pending_sender",
      userId: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
      shredAt: new Date(Date.now() + 86400000),
    });

    const cookie = await magicCookie("shop@example.com");
    const list = await listDocuments(
      new Request("http://sign.test/v1/documents", { headers: { cookie } }),
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { documents: { id: string }[] };
    expect(body.documents.some((e) => e.id === id)).toBe(true);
    expect(body.documents.some((e) => e.id === otherId)).toBe(false);
    const [claimed] = await db.select().from(documents).where(eq(documents.id, id));
    expect(claimed!.userId).toBe(userFor("shop@example.com").id);
    const [untouched] = await db.select().from(documents).where(eq(documents.id, otherId));
    expect(untouched!.userId).not.toBe(userFor("shop@example.com").id);
  });

  it("tmp keys cannot list documents", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    setDeps({
      db,
      store,
      mailer: { sendMail: async (m) => { sent.push(m); } },
    });
    const created = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        body: await documentForm(),
      }),
    );
    const { id } = (await created.json()) as { id: string };
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const verify = await postOtp(
      new Request(`http://sign.test/v1/documents/${id}/otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
      { params: Promise.resolve({ id }) },
    );
    const done = (await verify.json()) as { key: string };
    const list = await listDocuments(
      new Request("http://sign.test/v1/documents", {
        headers: { authorization: `Bearer ${done.key}` },
      }),
    );
    expect(list.status).toBe(401);
  });

  it("21st Free send in 30 days is 429; same after plan=pro is 201", { timeout: 120_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const { adapter, userFor } = createFakeAuth();
    const frozen = new Date("2026-08-20T12:00:00Z");
    setDeps({
      db,
      store,
      auth: adapter,
      now: () => frozen,
      mailer: { sendMail: async () => {} },
    });
    const cookie = await magicCookie("shop@example.com");
    const minted = await postKeys(
      new Request("http://sign.test/v1/keys", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      }),
    );
    const { key } = (await minted.json()) as { key: string };
    async function postOnce() {
      return postDocument(
        new Request("http://sign.test/v1/documents", {
          method: "POST",
          headers: { authorization: `Bearer ${key}` },
          body: await documentForm(),
        }),
      );
    }
    for (let i = 0; i < 20; i++) {
      const res = await postOnce();
      expect(res.status).toBe(201);
    }
    const over = await postOnce();
    expect(over.status).toBe(429);
    const json = (await over.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBeTruthy();
    expect(JSON.stringify(json)).not.toMatch(/20/);

    await db
      .update(accounts)
      .set({ plan: "pro" })
      .where(eq(accounts.userId, userFor("shop@example.com").id));
    const lifted = await postOnce();
    expect(lifted.status).toBe(201);
  });

  it("extendKeep lengthens shred_at on completed documents sent or signed", async () => {
    const db = await createTestDb();
    const userId = randomUUID();
    const signedAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-02T00:00:00Z");
    setDeps({ db, now: () => now });
    await db.insert(accounts).values({
      userId,
      email: "shop@example.com",
      plan: "free",
    });
    const [sentEnv] = await db
      .insert(documents)
      .values({
        title: "Sent",
        senderEmail: "shop@example.com",
        status: "completed",
        userId,
        expiresAt: signedAt,
        shredAt: new Date(signedAt.getTime() + 7 * 86_400_000),
      })
      .returning();
    await db.insert(documents).values({
      title: "Signed by them",
      senderEmail: "other@example.com",
      status: "completed",
      expiresAt: signedAt,
      shredAt: new Date(signedAt.getTime() + 7 * 86_400_000),
    }).returning();
    const signedRows = await db.select().from(documents);
    const signedEnv = signedRows.find((e) => e.title === "Signed by them")!;
    await db.insert(documents).values({
      title: "Unrelated",
      senderEmail: "nope@example.com",
      status: "completed",
      expiresAt: signedAt,
      shredAt: new Date(signedAt.getTime() + 7 * 86_400_000),
    });
    const { signers } = await import("../db/schema.js");
    await db.insert(signers).values({
      documentId: signedEnv.id,
      name: "Shop",
      email: "shop@example.com",
      signingOrder: 1,
      tokenHash: "hash-signed",
      signedAt,
    });
    await db.insert(signers).values({
      documentId: sentEnv!.id,
      name: "Jane",
      email: "jane@example.com",
      signingOrder: 1,
      tokenHash: "hash-sent",
      signedAt,
    });

    await extendKeep(db, userId);

    const [sentAfter] = await db.select().from(documents).where(eq(documents.id, sentEnv!.id));
    const [signedAfter] = await db.select().from(documents).where(eq(documents.id, signedEnv.id));
    const unrelated = (await db.select().from(documents)).find((e) => e.title === "Unrelated")!;
    const expected = signedAt.getTime() + 365 * 86_400_000;
    expect(sentAfter!.shredAt.getTime()).toBe(expected);
    expect(signedAfter!.shredAt.getTime()).toBe(expected);
    expect(unrelated.shredAt.getTime()).toBe(signedAt.getTime() + 7 * 86_400_000);

    const tmp = {
      kind: "tmp" as const,
      prefix: "sign_tmp_xxxx",
      tokenHash: "hash-tmp",
      documentId: sentEnv!.id,
      expiresAt: new Date(signedAt.getTime() + 7 * 86_400_000),
    };
    await db.insert(apiKeys).values(tmp);
    await extendKeep(db, userId);
    const [tmpAfter] = await db.select().from(apiKeys).where(eq(apiKeys.tokenHash, "hash-tmp"));
    expect(tmpAfter!.expiresAt.getTime()).toBe(expected);
  });

  it("live key GET/PDF allows documents the user sent or signed; DELETE is 403 unless sender", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const { adapter } = createFakeAuth();
    setDeps({
      db,
      store,
      auth: adapter,
      mailer: { sendMail: async (m) => { sent.push(m); } },
      p12: makeDevP12("test"),
      p12Passphrase: "test",
    });

    const shopCookie = await magicCookie("shop@example.com");
    const shopMint = await postKeys(
      new Request("http://sign.test/v1/keys", {
        method: "POST",
        headers: { cookie: shopCookie, "content-type": "application/json" },
        body: JSON.stringify({ expires_in_days: 30 }),
      }),
    );
    expect(shopMint.status).toBe(201);
    const { key: shopKey } = (await shopMint.json()) as { key: string };

    const created = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${shopKey}` },
        body: await documentForm(),
      }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const invite = sent.find((m) => m.to === "jane@example.com");
    expect(invite).toBeTruthy();
    const token = invite!.text.match(/\/s\/([A-Za-z0-9_-]+)/)![1]!;

    const consent = await postConsent(
      new Request(`http://sign.test/s/${token}/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(consent.status).toBe(200);
    const sig = new FormData();
    sig.set("png", new Blob([png], { type: "image/png" }), "sig.png");
    const sign = await postSign(
      new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body: sig }),
      { params: Promise.resolve({ token }) },
    );
    expect(sign.status).toBe(200);

    const janeCookie = await magicCookie("jane@example.com");
    const janeMint = await postKeys(
      new Request("http://sign.test/v1/keys", {
        method: "POST",
        headers: { cookie: janeCookie, "content-type": "application/json" },
        body: JSON.stringify({ expires_in_days: 30 }),
      }),
    );
    expect(janeMint.status).toBe(201);
    const { key: janeKey } = (await janeMint.json()) as { key: string };

    function bearer(key: string, url: string, method = "GET") {
      return new Request(url, {
        method,
        headers: { authorization: `Bearer ${key}` },
      });
    }

    const janeGet = await getDocument(
      bearer(janeKey, `http://sign.test/v1/documents/${id}`),
      { params: Promise.resolve({ id }) },
    );
    expect(janeGet.status).toBe(200);

    const janePdf = await getPdf(
      bearer(janeKey, `http://sign.test/v1/documents/${id}.pdf`),
      { params: Promise.resolve({ id }) },
    );
    expect(janePdf.status).toBe(200);

    const janeDel = await deleteDocument(
      bearer(janeKey, `http://sign.test/v1/documents/${id}`, "DELETE"),
      { params: Promise.resolve({ id }) },
    );
    expect(janeDel.status).toBe(403);
    const forbidden = (await janeDel.json()) as { error: string; code: string };
    expect(forbidden.error).toBeTruthy();
    expect(forbidden.code).toBe("forbidden");

    const shopGet = await getDocument(
      bearer(shopKey, `http://sign.test/v1/documents/${id}`),
      { params: Promise.resolve({ id }) },
    );
    expect(shopGet.status).toBe(200);

    const shopPdf = await getPdf(
      bearer(shopKey, `http://sign.test/v1/documents/${id}.pdf`),
      { params: Promise.resolve({ id }) },
    );
    expect(shopPdf.status).toBe(200);
  });

  it("OTP verify binds a matching Pro account so complete uses Pro keep", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const frozen = new Date("2026-08-20T12:00:00Z");
    const userId = randomUUID();
    setDeps({
      db,
      store,
      mailer: { sendMail: async (m) => { sent.push(m); } },
      now: () => frozen,
      p12: makeDevP12("test"),
      p12Passphrase: "test",
    });
    await db.insert(accounts).values({
      userId,
      email: "shop@example.com",
      plan: "pro",
    });
    const created = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        body: await documentForm("shop@example.com"),
      }),
    );
    const { id } = (await created.json()) as { id: string };
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const verify = await postOtp(
      new Request(`http://sign.test/v1/documents/${id}/otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(verify.status).toBe(200);
    const [bound] = await db.select().from(documents).where(eq(documents.id, id));
    expect(bound!.userId).toBe(userId);

    const done = (await verify.json()) as {
      signers: { sign_url: string | null }[];
    };
    const token = done.signers[0]!.sign_url!.replace(/^\/s\//, "");
    expect(
      (await postConsent(
        new Request(`http://sign.test/s/${token}/consent`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true }),
        }),
        { params: Promise.resolve({ token }) },
      )).status,
    ).toBe(200);
    expect(
      (await postSign(
        new Request(`http://sign.test/s/${token}/sign`, {
          method: "POST",
          body: (() => {
            const body = new FormData();
            body.set("png", new Blob([png], { type: "image/png" }), "sig.png");
            return body;
          })(),
        }),
        { params: Promise.resolve({ token }) },
      )).status,
    ).toBe(200);
    const [completed] = await db.select().from(documents).where(eq(documents.id, id));
    expect(completed!.shredAt.getTime()).toBe(frozen.getTime() + 365 * 86_400_000);
  });

  it("Pro login claims a completed one-off and extends keep; live-key list claims later sends", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const frozen = new Date("2026-08-20T12:00:00Z");
    const { adapter, userFor } = createFakeAuth();
    setDeps({
      db,
      store,
      auth: adapter,
      mailer: { sendMail: async (m) => { sent.push(m); } },
      now: () => frozen,
      p12: makeDevP12("test"),
      p12Passphrase: "test",
    });

    const created = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        body: await documentForm("shop@example.com"),
      }),
    );
    const { id } = (await created.json()) as { id: string };
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const verify = await postOtp(
      new Request(`http://sign.test/v1/documents/${id}/otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
      { params: Promise.resolve({ id }) },
    );
    const done = (await verify.json()) as {
      signers: { sign_url: string | null }[];
    };
    const token = done.signers[0]!.sign_url!.replace(/^\/s\//, "");
    expect(
      (await postConsent(
        new Request(`http://sign.test/s/${token}/consent`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ consent: true }),
        }),
        { params: Promise.resolve({ token }) },
      )).status,
    ).toBe(200);
    expect(
      (await postSign(
        new Request(`http://sign.test/s/${token}/sign`, {
          method: "POST",
          body: (() => {
            const body = new FormData();
            body.set("png", new Blob([png], { type: "image/png" }), "sig.png");
            return body;
          })(),
        }),
        { params: Promise.resolve({ token }) },
      )).status,
    ).toBe(200);
    const [before] = await db.select().from(documents).where(eq(documents.id, id));
    expect(before!.userId).toBeNull();
    expect(before!.shredAt.getTime()).toBe(frozen.getTime() + 7 * 86_400_000);

    const owner = userFor("shop@example.com");
    await db.insert(accounts).values({
      userId: owner.id,
      email: owner.email,
      plan: "pro",
    });
    const cookie = await magicCookie("shop@example.com");
    const [kept] = await db.select().from(documents).where(eq(documents.id, id));
    expect(kept!.userId).toBe(owner.id);
    expect(kept!.shredAt.getTime()).toBe(frozen.getTime() + 365 * 86_400_000);

    const minted = await postKeys(
      new Request("http://sign.test/v1/keys", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ expires_in_days: 30 }),
      }),
    );
    expect(minted.status).toBe(201);
    const keyJson = (await minted.json()) as { key: string };
    const extra = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        body: await documentForm("shop@example.com"),
      }),
    );
    const extraJson = (await extra.json()) as { id: string };
    const listed = await listDocuments(
      new Request("http://sign.test/v1/documents", {
        headers: { authorization: `Bearer ${keyJson.key}` },
      }),
    );
    expect(listed.status).toBe(200);
    const [claimedExtra] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, extraJson.id));
    expect(claimedExtra!.userId).toBe(owner.id);
  });
});
