import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import { GET as listEnvelopes, POST as postEnvelope } from "../../app/v1/envelopes/route.js";
import { POST as postOtp } from "../../app/v1/envelopes/[id]/otp/route.js";
import { DELETE as deleteEnvelope, GET as getEnvelope } from "../../app/v1/envelopes/[id]/route.js";
import { GET as getPdf } from "../../app/v1/envelopes/[id]/pdf/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { accounts, apiKeys, envelopes } from "../db/schema.js";
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

async function envelopeForm(sender = "shop@example.com") {
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
    expect(stored[0]!.envelopeId).toBeNull();
    expect(JSON.stringify(stored)).not.toContain(keyJson.key);

    const beforeMail = sent.length;
    const res = await postEnvelope(
      new Request("http://sign.test/v1/envelopes", {
        method: "POST",
        headers: { authorization: `Bearer ${keyJson.key}` },
        body: await envelopeForm(),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; status: string };
    expect(created.status).toBe("pending");
    const otpMails = sent.slice(beforeMail).filter((m) =>
      /verification code/i.test(m.subject),
    );
    expect(otpMails).toHaveLength(0);
    expect(sent.slice(beforeMail).some((m) => /please sign/i.test(m.subject))).toBe(
      true,
    );

    const [row] = await db.select().from(envelopes).where(eq(envelopes.id, created.id));
    expect(row!.status).toBe("pending");
    expect(row!.userId).toBe(userFor("shop@example.com").id);

    const listed = await listEnvelopes(
      new Request("http://sign.test/v1/envelopes", {
        headers: { authorization: `Bearer ${keyJson.key}` },
      }),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { envelopes: { id: string; status: string }[] };
    expect(body.envelopes.some((e) => e.id === created.id)).toBe(true);

    const sessionList = await listEnvelopes(
      new Request("http://sign.test/v1/envelopes", { headers: { cookie } }),
    );
    expect(sessionList.status).toBe(200);

    const queryKey = await listEnvelopes(
      new Request(`http://sign.test/v1/envelopes?apiKey=${keyJson.key}`),
    );
    expect(queryKey.status).toBe(401);
    const qerr = (await queryKey.json()) as { error: string; code: string };
    expect(qerr.error).toBeTruthy();
    expect(qerr.code).toBeTruthy();
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
    const created = await postEnvelope(
      new Request("http://sign.test/v1/envelopes", {
        method: "POST",
        body: await envelopeForm("shop@example.com"),
      }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const [before] = await db.select().from(envelopes).where(eq(envelopes.id, id));
    expect(before!.userId).toBeNull();

    const otherId = randomUUID();
    await db.insert(envelopes).values({
      id: otherId,
      title: "Someone else's",
      senderEmail: "shop@example.com",
      status: "pending_sender",
      userId: randomUUID(),
      expiresAt: new Date(Date.now() + 86400000),
      shredAt: new Date(Date.now() + 86400000),
    });

    const cookie = await magicCookie("shop@example.com");
    const list = await listEnvelopes(
      new Request("http://sign.test/v1/envelopes", { headers: { cookie } }),
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { envelopes: { id: string }[] };
    expect(body.envelopes.some((e) => e.id === id)).toBe(true);
    expect(body.envelopes.some((e) => e.id === otherId)).toBe(false);
    const [claimed] = await db.select().from(envelopes).where(eq(envelopes.id, id));
    expect(claimed!.userId).toBe(userFor("shop@example.com").id);
    const [untouched] = await db.select().from(envelopes).where(eq(envelopes.id, otherId));
    expect(untouched!.userId).not.toBe(userFor("shop@example.com").id);
  });

  it("tmp keys cannot list envelopes", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    setDeps({
      db,
      store,
      mailer: { sendMail: async (m) => { sent.push(m); } },
    });
    const created = await postEnvelope(
      new Request("http://sign.test/v1/envelopes", {
        method: "POST",
        body: await envelopeForm(),
      }),
    );
    const { id } = (await created.json()) as { id: string };
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const verify = await postOtp(
      new Request(`http://sign.test/v1/envelopes/${id}/otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
      { params: Promise.resolve({ id }) },
    );
    const done = (await verify.json()) as { key: string };
    const list = await listEnvelopes(
      new Request("http://sign.test/v1/envelopes", {
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
      return postEnvelope(
        new Request("http://sign.test/v1/envelopes", {
          method: "POST",
          headers: { authorization: `Bearer ${key}` },
          body: await envelopeForm(),
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

  it("extendKeep lengthens shred_at on completed envelopes sent or signed", async () => {
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
      .insert(envelopes)
      .values({
        title: "Sent",
        senderEmail: "shop@example.com",
        status: "completed",
        userId,
        expiresAt: signedAt,
        shredAt: new Date(signedAt.getTime() + 7 * 86_400_000),
      })
      .returning();
    await db.insert(envelopes).values({
      title: "Signed by them",
      senderEmail: "other@example.com",
      status: "completed",
      expiresAt: signedAt,
      shredAt: new Date(signedAt.getTime() + 7 * 86_400_000),
    }).returning();
    const signedRows = await db.select().from(envelopes);
    const signedEnv = signedRows.find((e) => e.title === "Signed by them")!;
    await db.insert(envelopes).values({
      title: "Unrelated",
      senderEmail: "nope@example.com",
      status: "completed",
      expiresAt: signedAt,
      shredAt: new Date(signedAt.getTime() + 7 * 86_400_000),
    });
    const { signers } = await import("../db/schema.js");
    await db.insert(signers).values({
      envelopeId: signedEnv.id,
      name: "Shop",
      email: "shop@example.com",
      signingOrder: 1,
      tokenHash: "hash-signed",
      signedAt,
    });
    await db.insert(signers).values({
      envelopeId: sentEnv!.id,
      name: "Jane",
      email: "jane@example.com",
      signingOrder: 1,
      tokenHash: "hash-sent",
      signedAt,
    });

    await extendKeep(db, userId);

    const [sentAfter] = await db.select().from(envelopes).where(eq(envelopes.id, sentEnv!.id));
    const [signedAfter] = await db.select().from(envelopes).where(eq(envelopes.id, signedEnv.id));
    const unrelated = (await db.select().from(envelopes)).find((e) => e.title === "Unrelated")!;
    const expected = signedAt.getTime() + 365 * 86_400_000;
    expect(sentAfter!.shredAt.getTime()).toBe(expected);
    expect(signedAfter!.shredAt.getTime()).toBe(expected);
    expect(unrelated.shredAt.getTime()).toBe(signedAt.getTime() + 7 * 86_400_000);
  });

  it("live key GET/PDF allows envelopes the user sent or signed; DELETE is 403 unless sender", { timeout: 60_000 }, async () => {
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

    const created = await postEnvelope(
      new Request("http://sign.test/v1/envelopes", {
        method: "POST",
        headers: { authorization: `Bearer ${shopKey}` },
        body: await envelopeForm(),
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

    const janeGet = await getEnvelope(
      bearer(janeKey, `http://sign.test/v1/envelopes/${id}`),
      { params: Promise.resolve({ id }) },
    );
    expect(janeGet.status).toBe(200);

    const janePdf = await getPdf(
      bearer(janeKey, `http://sign.test/v1/envelopes/${id}.pdf`),
      { params: Promise.resolve({ id }) },
    );
    expect(janePdf.status).toBe(200);

    const janeDel = await deleteEnvelope(
      bearer(janeKey, `http://sign.test/v1/envelopes/${id}`, "DELETE"),
      { params: Promise.resolve({ id }) },
    );
    expect(janeDel.status).toBe(403);
    const forbidden = (await janeDel.json()) as { error: string; code: string };
    expect(forbidden.error).toBeTruthy();
    expect(forbidden.code).toBe("forbidden");

    const shopGet = await getEnvelope(
      bearer(shopKey, `http://sign.test/v1/envelopes/${id}`),
      { params: Promise.resolve({ id }) },
    );
    expect(shopGet.status).toBe(200);

    const shopPdf = await getPdf(
      bearer(shopKey, `http://sign.test/v1/envelopes/${id}.pdf`),
      { params: Promise.resolve({ id }) },
    );
    expect(shopPdf.status).toBe(200);
  });
});
