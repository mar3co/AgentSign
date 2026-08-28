import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { POST as postAgents } from "../../app/v1/agents/route.js";
import { GET as listDocuments, POST as postDocument } from "../../app/v1/documents/route.js";
import { GET as getDocument } from "../../app/v1/documents/[id]/route.js";
import { POST as postOtp } from "../../app/v1/documents/[id]/otp/route.js";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import {
  accounts,
  apiKeys,
  documents,
  otpChallenges,
  signers as signersTable,
} from "../db/schema.js";
import { resetEnvCache } from "../env.js";
import { getDeps, resetDeps, setDeps } from "../lib/deps.js";
import { parsePdfTags } from "../lib/pdf/tags.js";
import { createFsStore, objectKey } from "../lib/storage.js";
import { PDFDocument, StandardFonts } from "pdf-lib";
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

async function startDocument(now?: () => Date) {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const sent: { to: string; subject: string; text: string }[] = [];
  setDeps({
    db,
    store,
    mailer: { sendMail: async (m) => { sent.push(m); } },
    now: now ?? (() => new Date()),
  });
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", "Repair authorization");
  body.set("sender_email", "shop@example.com");
  body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  const res = await postDocument(new Request("http://sign.test/v1/documents", { method: "POST", body }));
  expect(res.status).toBe(201);
  const json = await res.json() as { id: string; status: string };
  return { db, sent, id: json.id };
}

function postOtpCode(id: string, code: string) {
  return postOtp(
    new Request(`http://sign.test/v1/documents/${id}/otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("POST /v1/documents", () => {
  it("one-off send is pending_sender until OTP", async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    setDeps({
      db,
      store,
      mailer: { sendMail: async (m) => { sent.push(m); } },
    });
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const res = await postDocument(new Request("http://sign.test/v1/documents", { method: "POST", body }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("pending_sender");
    expect(sent[0]!.to).toBe("shop@example.com");
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const verify = await postOtp(
      new Request(`http://sign.test/v1/documents/${json.id}/otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
      { params: Promise.resolve({ id: json.id }) },
    );
    expect(verify.status).toBe(200);
    const done = await verify.json();
    expect(done.status).toBe("pending");
    expect(done.key).toMatch(/^sign_tmp_/);
    expect(done.signers[0].sign_url).toMatch(/^\/s\//);
    const leaked = await db.select().from(otpChallenges);
    expect(JSON.stringify(leaked)).not.toContain(code);
    expect(JSON.stringify(leaked)).not.toContain(done.key);
  });

  it("returns 429 after the free send cap for a sender_email", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const frozen = new Date("2026-08-20T12:00:00Z");
    setDeps({
      db,
      store,
      mailer: { sendMail: async (m) => { sent.push(m); } },
      now: () => frozen,
    });
    const pdf = await minimalPdf();
    async function postOnce() {
      const body = new FormData();
      body.set("title", "Repair authorization");
      body.set("sender_email", "cap@example.com");
      body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
      body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
      return postDocument(new Request("http://sign.test/v1/documents", { method: "POST", body }));
    }
    for (let i = 0; i < 20; i++) {
      const res = await postOnce();
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      await db.update(documents).set({ status: "pending" }).where(eq(documents.id, id));
    }
    const over = await postOnce();
    expect(over.status).toBe(429);
    const json = await over.json();
    expect(json.error).toBeTruthy();
    expect(json.code).toBeTruthy();
    expect(JSON.stringify(json)).not.toMatch(/20/);
  });

  it("voided documents still count toward the free send cap", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const frozen = new Date("2026-08-20T12:00:00Z");
    setDeps({
      db,
      store,
      mailer: { sendMail: async () => {} },
      now: () => frozen,
    });
    const pdf = await minimalPdf();
    async function postOnce() {
      const body = new FormData();
      body.set("title", "Repair authorization");
      body.set("sender_email", "voidcap@example.com");
      body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
      body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
      return postDocument(new Request("http://sign.test/v1/documents", { method: "POST", body }));
    }
    for (let i = 0; i < 20; i++) {
      const res = await postOnce();
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      await db.update(documents).set({ status: "deleted" }).where(eq(documents.id, id));
    }
    const over = await postOnce();
    expect(over.status).toBe(429);
  });

  it("unverified pending_sender rows do not consume the free send cap", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    setDeps({
      db,
      store,
      mailer: { sendMail: async () => {} },
      now: () => new Date("2026-08-20T12:00:00Z"),
    });
    const pdf = await minimalPdf();
    async function postOnce() {
      const body = new FormData();
      body.set("title", "Repair authorization");
      body.set("sender_email", "unverified-cap@example.com");
      body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
      body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
      return postDocument(new Request("http://sign.test/v1/documents", { method: "POST", body }));
    }
    for (let i = 0; i < 21; i++) {
      expect((await postOnce()).status).toBe(201);
    }
  });

  it("create OTP mail throw still returns 201 pending_sender", async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    setDeps({
      db,
      store,
      mailer: { sendMail: async () => { throw new Error("resend down"); } },
    });
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", { method: "POST", body }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string; status: string };
    expect(json.status).toBe("pending_sender");
    const [row] = await db.select().from(documents).where(eq(documents.id, json.id));
    expect(row!.status).toBe("pending_sender");
  });

  it("OTP mail failure still returns the tmp key", async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    let failAfterOtp = false;
    setDeps({
      db,
      store,
      mailer: {
        sendMail: async (m) => {
          if (failAfterOtp) throw new Error("resend down");
          sent.push(m);
        },
      },
    });
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const created = await postDocument(
      new Request("http://sign.test/v1/documents", { method: "POST", body }),
    );
    const { id } = (await created.json()) as { id: string };
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    failAfterOtp = true;
    const verify = await postOtpCode(id, code);
    expect(verify.status).toBe(200);
    const done = (await verify.json()) as { key: string; signers: { sign_url: string | null }[] };
    expect(done.key).toMatch(/^sign_tmp_/);
    expect(done.signers[0]!.sign_url).toMatch(/^\/s\//);
  });

  it("wrong OTP increments attempts and returns invalid_otp", async () => {
    const { db, sent, id } = await startDocument();
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const wrong = code === "000000" ? "000001" : "000000";
    const res = await postOtpCode(id, wrong);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("invalid_otp");
    const [row] = await db.select().from(otpChallenges).where(eq(otpChallenges.documentId, id));
    expect(row!.attempts).toBe(1);
  });

  it("five OTP failures lock with 403", { timeout: 30_000 }, async () => {
    const { db, sent, id } = await startDocument();
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 4; i++) {
      const res = await postOtpCode(id, wrong);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_otp");
    }
    const fifth = await postOtpCode(id, wrong);
    expect(fifth.status).toBe(403);
    const locked = await fifth.json();
    expect(locked.error).toBeTruthy();
    expect(locked.code).toBe("otp_locked");
    const [row] = await db.select().from(otpChallenges).where(eq(otpChallenges.documentId, id));
    expect(row!.attempts).toBe(5);
    const sixth = await postOtpCode(id, wrong);
    expect(sixth.status).toBe(403);
    expect((await sixth.json()).code).toBe("otp_locked");
  });

  it("expired OTP challenge returns 410", async () => {
    let at = new Date("2026-08-20T12:00:00Z");
    const { sent, id } = await startDocument(() => at);
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    at = new Date(at.getTime() + 11 * 60 * 1000);
    const res = await postOtpCode(id, code);
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("otp_expired");
  });

  it("second OTP after success is not 200 and does not issue a new tmp key", async () => {
    const { db, sent, id } = await startDocument();
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const first = await postOtpCode(id, code);
    expect(first.status).toBe(200);
    const done = await first.json();
    expect(done.key).toMatch(/^sign_tmp_/);
    const second = await postOtpCode(id, code);
    expect(second.status).not.toBe(200);
    const json = await second.json();
    expect(json.error).toBeTruthy();
    expect(json.code).toBeTruthy();
    expect(JSON.stringify(json)).not.toMatch(/sign_tmp_/);
    const keys = await db.select().from(apiKeys).where(eq(apiKeys.documentId, id));
    expect(keys).toHaveLength(1);
  });

  it("OTP on a non-pending_sender document returns 409 and does not consume or mint a key", async () => {
    const { db, sent, id } = await startDocument();
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    await db.update(documents).set({ status: "pending" }).where(eq(documents.id, id));
    const res = await postOtpCode(id, code);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("invalid_state");
    expect(JSON.stringify(json)).not.toMatch(/sign_tmp_/);
    const [challenge] = await db.select().from(otpChallenges).where(eq(otpChallenges.documentId, id));
    expect(challenge!.consumedAt).toBeNull();
    const keys = await db.select().from(apiKeys).where(eq(apiKeys.documentId, id));
    expect(keys).toHaveLength(0);
  });

  it("session send as your own email goes out directly with a status key", async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const { adapter } = createFakeAuth();
    setDeps({
      db,
      store,
      auth: adapter,
      mailer: { sendMail: async (m) => { sent.push(m); } },
    });
    const cookie = await magicCookie("shop@example.com");
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string; status: string; key?: string };
    expect(json.status).toBe("pending");
    expect(json.key).toMatch(/^sign_tmp_/);
    const [row] = await db.select().from(documents).where(eq(documents.id, json.id));
    expect(row!.status).toBe("pending");
    expect(row!.userId).toBeTruthy();
    expect(sent.some((m) => /verification code/i.test(m.subject))).toBe(false);
    expect(sent.some((m) => m.to === "jane@example.com")).toBe(true);
  });

  it("session send keeps the code when Confirm my sends is on", async () => {
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
    await db
      .insert(accounts)
      .values({
        userId: userFor("shop@example.com").id,
        email: "shop@example.com",
        confirmHumanSends: true,
      })
      .onConflictDoUpdate({
        target: accounts.userId,
        set: { confirmHumanSends: true },
      });
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("pending_sender");
    expect(sent.some((m) => /verification code/i.test(m.subject))).toBe(true);
    expect(sent.some((m) => m.to === "jane@example.com")).toBe(false);
  });

  it("session send with a mismatched sender email stays pending_sender", async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const { adapter } = createFakeAuth();
    setDeps({
      db,
      store,
      auth: adapter,
      mailer: { sendMail: async (m) => { sent.push(m); } },
    });
    const cookie = await magicCookie("someone@example.com");
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("pending_sender");
    expect(sent.some((m) => m.to === "shop@example.com" && /verification code/i.test(m.subject))).toBe(true);
    expect(sent.some((m) => m.to === "jane@example.com")).toBe(false);
  });

  it("OTP verify is 429 when 20 sends in the window already exist", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const frozen = new Date("2026-08-20T12:00:00Z");
    setDeps({
      db,
      store,
      mailer: { sendMail: async (m) => { sent.push(m); } },
      now: () => frozen,
    });
    const pdf = await minimalPdf();
    async function postOnce() {
      const body = new FormData();
      body.set("title", "Repair authorization");
      body.set("sender_email", "otp-cap@example.com");
      body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
      body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
      return postDocument(new Request("http://sign.test/v1/documents", { method: "POST", body }));
    }
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await postOnce();
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      ids.push(id);
    }
    const codes = sent
      .filter((m) => m.to === "otp-cap@example.com")
      .map((m) => m.text.match(/\b(\d{6})\b/)![1]!);
    expect(codes).toHaveLength(21);
    for (let i = 0; i < 20; i++) {
      const verify = await postOtp(
        new Request(`http://sign.test/v1/documents/${ids[i]}/otp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: codes[i] }),
        }),
        { params: Promise.resolve({ id: ids[i]! }) },
      );
      expect(verify.status).toBe(200);
    }
    const last = await postOtp(
      new Request(`http://sign.test/v1/documents/${ids[20]}/otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: codes[20] }),
      }),
      { params: Promise.resolve({ id: ids[20]! }) },
    );
    expect(last.status).toBe(429);
    const json = (await last.json()) as { code: string };
    expect(json.code).toBe("send_limit");
    const [row] = await db.select().from(documents).where(eq(documents.id, ids[20]!));
    expect(row!.status).toBe("pending_sender");
  });

  it("stores a trimmed sender message on the OTP path", async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    setDeps({
      db,
      store,
      mailer: { sendMail: async () => {} },
    });
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    body.set("message", "  Please sign before Friday.  ");
    const res = await postDocument(new Request("http://sign.test/v1/documents", { method: "POST", body }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row!.message).toBe("Please sign before Friday.");
  });

  it("rejects a message over 1000 characters", async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    setDeps({
      db,
      store,
      mailer: { sendMail: async () => {} },
    });
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    body.set("message", "x".repeat(1001));
    const res = await postDocument(new Request("http://sign.test/v1/documents", { method: "POST", body }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe("invalid_request");
  });

  it("stores null when message is blank", async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    setDeps({
      db,
      store,
      mailer: { sendMail: async () => {} },
    });
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    body.set("message", "   ");
    const res = await postDocument(new Request("http://sign.test/v1/documents", { method: "POST", body }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row!.message).toBeNull();
  });
});

type DocumentStatusJson = {
  id: string;
  status: string;
  current_party: {
    index: number;
    kind: "human" | "agent";
    email: string;
    agent?: string;
  } | null;
  signers: Array<{
    kind: "human" | "agent";
    email: string;
    agent?: string;
    signed_at: string | null;
    attested_at: string | null;
    declined_at: string | null;
    rejected_at: string | null;
  }>;
};

async function bootAuth() {
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
  });
  return { db, sent, userFor };
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

async function documentBody(signers: unknown, sender = "shop@example.com") {
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", "Repair authorization");
  body.set("sender_email", sender);
  body.set("signers", JSON.stringify(signers));
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  return body;
}

afterEach(() => {
  delete process.env.SIGN_FLAG_AGENT_PARTIES;
  resetEnvCache();
  resetDeps();
});

describe("POST /v1/documents agent parties", () => {
  it("omitted kind still creates a human party", async () => {
    await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: await documentBody([{ name: "Jane", email: "jane@example.com" }]),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; status: string };
    expect(created.status).toBe("pending");

    const status = await getDocument(
      new Request(`http://sign.test/v1/documents/${created.id}`, {
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(status.status).toBe(200);
    const json = (await status.json()) as DocumentStatusJson;
    expect(json.signers).toHaveLength(1);
    expect(json.signers[0]!.kind).toBe("human");
    expect(json.signers[0]!.email).toBe("jane@example.com");
    expect(json.signers[0]!.agent).toBeUndefined();
    expect(json.current_party).toEqual({
      index: 0,
      kind: "human",
      email: "jane@example.com",
    });
  });

  it("Pro live key can send A then H and GET shows current_party agent", async () => {
    const { db, sent, userFor } = await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const userId = userFor("shop@example.com").id;
    await db.update(accounts).set({ plan: "pro" }).where(eq(accounts.userId, userId));

    const createdAgent = await postAgents(
      new Request("http://sign.test/v1/agents", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ slug: "grok-legal", name: "Grok Legal" }),
      }),
    );
    expect(createdAgent.status).toBe(201);

    const key = await mintLive(cookie);
    const beforeMail = sent.length;
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: await documentBody([
          {
            name: "Grok Legal",
            email: "shop@example.com",
            kind: "agent",
            agent: "grok-legal",
          },
          { name: "Jane", email: "jane@example.com" },
        ]),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; status: string };
    expect(created.status).toBe("pending");

    const rows = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, created.id));
    rows.sort((a, b) => a.signingOrder - b.signingOrder);
    expect(rows[0]!.kind).toBe("agent");
    expect(rows[0]!.agentId).toBeTruthy();
    expect(rows[0]!.tokenHash).toBeNull();
    expect(rows[0]!.tokenEnc).toBeNull();
    expect(rows[1]!.kind).toBe("human");
    expect(rows[1]!.agentId).toBeNull();

    const afterMail = sent.slice(beforeMail);
    expect(afterMail.some((m) => /please sign/i.test(m.subject))).toBe(false);
    expect(afterMail.some((m) => m.to === "jane@example.com")).toBe(false);
    expect(afterMail.some((m) => m.to === "shop@example.com" && /please sign/i.test(m.subject))).toBe(
      false,
    );

    const status = await getDocument(
      new Request(`http://sign.test/v1/documents/${created.id}`, {
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(status.status).toBe(200);
    const json = (await status.json()) as DocumentStatusJson;
    expect(json.current_party).toEqual({
      index: 0,
      kind: "agent",
      email: "shop@example.com",
      agent: "grok-legal",
    });
    expect(json.signers).toHaveLength(2);
    expect(json.signers[0]).toMatchObject({
      kind: "agent",
      email: "shop@example.com",
      agent: "grok-legal",
      signed_at: null,
      attested_at: null,
      declined_at: null,
      rejected_at: null,
    });
    expect(json.signers[1]).toMatchObject({
      kind: "human",
      email: "jane@example.com",
      signed_at: null,
      attested_at: null,
      declined_at: null,
      rejected_at: null,
    });
    expect(json.signers[1]!.agent).toBeUndefined();
  });

  it("GET /v1/documents lists party kind and signed vs attested", async () => {
    const { db, userFor } = await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const userId = userFor("shop@example.com").id;
    await db.update(accounts).set({ plan: "pro" }).where(eq(accounts.userId, userId));

    const createdAgent = await postAgents(
      new Request("http://sign.test/v1/agents", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ slug: "grok-legal", name: "Grok Legal" }),
      }),
    );
    expect(createdAgent.status).toBe(201);

    const key = await mintLive(cookie);
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: await documentBody([
          {
            name: "Grok Legal",
            email: "shop@example.com",
            kind: "agent",
            agent: "grok-legal",
          },
          { name: "Jane", email: "jane@example.com" },
        ]),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };

    const listed = await listDocuments(
      new Request("http://sign.test/v1/documents", {
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      documents: Array<{
        id: string;
        signers: Array<{
          name: string;
          kind: string;
          email: string;
          agent?: string;
          signed_at: string | null;
          attested_at: string | null;
        }>;
      }>;
    };
    const row = body.documents.find((e) => e.id === created.id);
    expect(row?.signers).toEqual([
      {
        name: "Grok Legal",
        kind: "agent",
        email: "shop@example.com",
        agent: "grok-legal",
        signed_at: null,
        attested_at: null,
      },
      {
        name: "Jane",
        kind: "human",
        email: "jane@example.com",
        signed_at: null,
        attested_at: null,
      },
    ]);
  });

  it("Free live key send with kind agent is 403 pro_required", async () => {
    await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: await documentBody([
          {
            name: "Grok Legal",
            email: "shop@example.com",
            kind: "agent",
            agent: "grok-legal",
          },
        ]),
      }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("pro_required");
  });

  it("send without WEBHOOK_KEK is 503 and does not insert a document", async () => {
    const prevKek = process.env.WEBHOOK_KEK;
    const prevCron = process.env.CRON_SECRET;
    delete process.env.WEBHOOK_KEK;
    delete process.env.CRON_SECRET;
    resetEnvCache();
    try {
      const { db } = await bootAuth();
      const cookie = await magicCookie("shop@example.com");
      const key = await mintLive(cookie);
      const before = await db.select().from(documents);
      const res = await postDocument(
        new Request("http://sign.test/v1/documents", {
          method: "POST",
          headers: { authorization: `Bearer ${key}` },
          body: await documentBody([{ name: "Jane", email: "jane@example.com" }]),
        }),
      );
      expect(res.status).toBe(503);
      const json = (await res.json()) as { error: string; code: string };
      expect(json.code).toBe("webhook_unconfigured");
      expect(json.error).toBeTruthy();
      const after = await db.select().from(documents);
      expect(after).toHaveLength(before.length);
    } finally {
      if (prevKek === undefined) delete process.env.WEBHOOK_KEK;
      else process.env.WEBHOOK_KEK = prevKek;
      if (prevCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevCron;
      resetEnvCache();
    }
  });

  it("unknown agent slug is 400 unknown_agent", async () => {
    const { db, userFor } = await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    await db
      .update(accounts)
      .set({ plan: "pro" })
      .where(eq(accounts.userId, userFor("shop@example.com").id));
    const key = await mintLive(cookie);
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: await documentBody([
          {
            name: "Grok Legal",
            email: "shop@example.com",
            kind: "agent",
            agent: "missing",
          },
        ]),
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("unknown_agent");
  });

  it("agent party is 403 flag_off when agent_parties is off", async () => {
    const { db, userFor } = await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    await db
      .update(accounts)
      .set({ plan: "pro" })
      .where(eq(accounts.userId, userFor("shop@example.com").id));
    const createdAgent = await postAgents(
      new Request("http://sign.test/v1/agents", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ slug: "grok-legal", name: "Grok Legal" }),
      }),
    );
    expect(createdAgent.status).toBe(201);
    process.env.SIGN_FLAG_AGENT_PARTIES = "0";
    resetEnvCache();
    const key = await mintLive(cookie);
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: await documentBody([
          {
            name: "Grok Legal",
            email: "shop@example.com",
            kind: "agent",
            agent: "grok-legal",
          },
        ]),
      }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("flag_off");
  });

  it("unauthenticated one-off with kind agent is 403 pro_required", async () => {
    await bootAuth();
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        body: await documentBody([
          {
            name: "Grok Legal",
            email: "shop@example.com",
            kind: "agent",
            agent: "grok-legal",
          },
        ]),
      }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("pro_required");
  });
});

async function taggedPdf(labels: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 700;
  for (const label of labels) {
    page.drawText(label, { x: 72, y, size: 12, font });
    y -= 24;
  }
  return doc.save();
}

function area() {
  return { page: 1, x: 10, y: 20, w: 30, h: 8 };
}

describe("POST /v1/documents on-page fields", () => {
  it("parses tags, stores fields, and returns every human sign_url", {
    timeout: 60_000,
  }, async () => {
    await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const pdf = await taggedPdf(["{{sig}}"]);
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set(
      "signers",
      JSON.stringify([
        { name: "Jane", email: "jane@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ]),
    );
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      id: string;
      signers: { email: string; sign_url?: string }[];
    };
    expect(json.signers).toHaveLength(2);
    expect(json.signers[0]!.sign_url).toMatch(/^\/s\//);
    expect(json.signers[1]!.sign_url).toMatch(/^\/s\//);

    const status = await getDocument(
      new Request(`http://sign.test/v1/documents/${json.id}`, {
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ id: json.id }) },
    );
    expect(status.status).toBe(200);
    const got = (await status.json()) as { fields: { name: string }[] };
    expect(got.fields.some((f) => f.name === "sig")).toBe(true);

    const stored = await getDeps().store?.get(objectKey(json.id, "original"));
    expect(stored).toBeTruthy();
    const again = await parsePdfTags(stored!);
    expect(again.fields).toEqual([]);
  });

  it("rejects a field on a page the PDF does not have", { timeout: 60_000 }, async () => {
    await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const body = await documentBody([{ name: "Jane", email: "jane@example.com" }]);
    body.set(
      "fields",
      JSON.stringify([
        {
          name: "sig",
          type: "signature",
          role: "Signer 1",
          required: true,
          readonly: false,
          areas: [{ page: 2, x: 10, y: 20, w: 30, h: 8 }],
        },
      ]),
    );
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_fields");
  });

  it("rejects a readonly field without a value", { timeout: 60_000 }, async () => {
    await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const body = await documentBody([{ name: "Jane", email: "jane@example.com" }]);
    body.set(
      "fields",
      JSON.stringify([
        {
          name: "Title",
          type: "text",
          role: "Signer 1",
          required: false,
          readonly: true,
          areas: [area()],
        },
      ]),
    );
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_values");
  });

  it("rejects tag and API fields that conflict on type", { timeout: 60_000 }, async () => {
    await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const pdf = await taggedPdf(["{{sig}}"]);
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set(
      "signers",
      JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
    );
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    body.set(
      "fields",
      JSON.stringify([
        {
          name: "sig",
          type: "text",
          role: "Signer 1",
          required: true,
          readonly: false,
          areas: [area()],
        },
      ]),
    );
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_fields");
  });

  it("rejects a signature field on an agent role", { timeout: 60_000 }, async () => {
    const { db, userFor } = await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    await db
      .update(accounts)
      .set({ plan: "pro" })
      .where(eq(accounts.userId, userFor("shop@example.com").id));
    const createdAgent = await postAgents(
      new Request("http://sign.test/v1/agents", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ slug: "grok-legal", name: "Grok Legal" }),
      }),
    );
    expect(createdAgent.status).toBe(201);
    const key = await mintLive(cookie);
    const body = await documentBody([
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
        role: "grok",
      },
      { name: "Jane", email: "jane@example.com" },
    ]);
    body.set(
      "fields",
      JSON.stringify([
        {
          name: "sig",
          type: "signature",
          role: "grok",
          required: true,
          readonly: false,
          areas: [area()],
        },
      ]),
    );
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("invalid_fields");
  });

  it("rejects fields with zero humans", { timeout: 60_000 }, async () => {
    const { db, userFor } = await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    await db
      .update(accounts)
      .set({ plan: "pro" })
      .where(eq(accounts.userId, userFor("shop@example.com").id));
    const createdAgent = await postAgents(
      new Request("http://sign.test/v1/agents", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ slug: "grok-legal", name: "Grok Legal" }),
      }),
    );
    expect(createdAgent.status).toBe(201);
    const key = await mintLive(cookie);
    const body = await documentBody([
      {
        name: "Grok Legal",
        email: "shop@example.com",
        kind: "agent",
        agent: "grok-legal",
        role: "grok",
      },
    ]);
    body.set(
      "fields",
      JSON.stringify([
        {
          name: "Note",
          type: "text",
          role: "grok",
          required: false,
          readonly: true,
          default_value: "ok",
          areas: [area()],
        },
      ]),
    );
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("invalid_fields");
  });

  it("rejects duplicate signer roles when fields exist", { timeout: 60_000 }, async () => {
    await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const body = await documentBody([
      { name: "Jane", email: "jane@example.com", role: "Customer" },
      { name: "Bob", email: "bob@example.com", role: "Customer" },
    ]);
    body.set(
      "fields",
      JSON.stringify([
        {
          name: "sig",
          type: "signature",
          role: "Customer",
          required: true,
          readonly: false,
          areas: [area()],
        },
      ]),
    );
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("invalid_fields");
  });

  it("rejects a default role that collides with another signer when fields exist", {
    timeout: 60_000,
  }, async () => {
    await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const body = await documentBody([
      { name: "Jane", email: "jane@example.com", role: "Signer 2" },
      { name: "Bob", email: "bob@example.com" },
    ]);
    body.set(
      "fields",
      JSON.stringify([
        {
          name: "sig",
          type: "signature",
          role: "Signer 2",
          required: true,
          readonly: false,
          areas: [area()],
        },
      ]),
    );
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("invalid_fields");
  });

  it("applies per-signer prefill over document values", { timeout: 60_000 }, async () => {
    await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const body = await documentBody([
      {
        name: "Jane",
        email: "jane@example.com",
        values: { "Full Name": "Jane" },
      },
    ]);
    body.set(
      "fields",
      JSON.stringify([
        {
          name: "Full Name",
          type: "text",
          role: "Signer 1",
          required: false,
          readonly: false,
          areas: [area()],
        },
      ]),
    );
    body.set("values", JSON.stringify({ "Full Name": "Doc" }));
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };
    const status = await getDocument(
      new Request(`http://sign.test/v1/documents/${created.id}`, {
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(status.status).toBe(200);
    const got = (await status.json()) as {
      signers: { values?: Record<string, string | boolean> }[];
    };
    expect(got.signers[0]!.values?.["Full Name"]).toBe("Jane");
  });

  it("GET sign_url is omitted for a signer account", { timeout: 60_000 }, async () => {
    await bootAuth();
    const ownerCookie = await magicCookie("shop@example.com");
    const key = await mintLive(ownerCookie);
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: await documentBody([
          { name: "Jane", email: "jane@example.com" },
          { name: "Bob", email: "bob@example.com" },
        ]),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      signers: { sign_url?: string }[];
    };
    expect(created.signers[0]!.sign_url).toMatch(/^\/s\//);
    expect(created.signers[1]!.sign_url).toMatch(/^\/s\//);

    const janeCookie = await magicCookie("jane@example.com");
    const asSigner = await getDocument(
      new Request(`http://sign.test/v1/documents/${created.id}`, {
        headers: { cookie: janeCookie },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(asSigner.status).toBe(200);
    const signerGot = (await asSigner.json()) as {
      signers: { sign_url?: string }[];
    };
    expect(signerGot.signers.some((s) => s.sign_url)).toBe(false);

    const asOwner = await getDocument(
      new Request(`http://sign.test/v1/documents/${created.id}`, {
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(asOwner.status).toBe(200);
    const ownerGot = (await asOwner.json()) as {
      signers: { sign_url?: string }[];
    };
    expect(ownerGot.signers[0]!.sign_url).toMatch(/^\/s\//);
    expect(ownerGot.signers[1]!.sign_url).toMatch(/^\/s\//);
  });

  it("send_email false mints URLs and does not send invite mail", async () => {
    const { db, sent } = await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const body = await documentBody([
      { name: "Jane", email: "jane@example.com" },
    ]);
    body.set("send_email", "false");
    const before = sent.length;
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      id: string;
      signers: { email: string; sign_url?: string }[];
    };
    expect(json.signers[0]!.sign_url).toMatch(/^\/s\//);
    const after = sent.slice(before);
    expect(after.some((m) => m.to === "jane@example.com")).toBe(false);
    expect(after.some((m) => /please sign/i.test(m.subject))).toBe(false);
    const rows = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, json.id));
    expect(rows[0]!.sentAt).toBeTruthy();
  });

  it("completed_redirect_url to http is 400", async () => {
    await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const body = await documentBody([
      { name: "Jane", email: "jane@example.com" },
    ]);
    body.set("completed_redirect_url", "http://app.example.com/done");
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("stores a trimmed sender message on the live-key path", async () => {
    const { db } = await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const body = await documentBody([{ name: "Jane", email: "jane@example.com" }]);
    body.set("message", "  Please sign before Friday.  ");
    const res = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body,
      }),
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row!.message).toBe("Please sign before Friday.");
  });
});
