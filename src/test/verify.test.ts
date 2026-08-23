import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { POST as postAgents } from "../../app/v1/agents/route.js";
import { POST as postAttest } from "../../app/v1/documents/[id]/attest/route.js";
import { POST as postDocument } from "../../app/v1/documents/route.js";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import { POST as postOtp } from "../../app/v1/documents/[id]/otp/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { POST as postVerify } from "../../app/v1/verify/route.js";
import { accounts, documents } from "../db/schema.js";
import { resetEnvCache } from "../env.js";
import { resetDeps, setDeps } from "../lib/deps.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { completeDocumentPdf } from "../lib/pdf/complete.js";
import { createFsStore } from "../lib/storage.js";
import { verifySealedPdf } from "../lib/verify.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";
import {
  PDFDocument,
  PageSizes,
  StandardFonts,
  PDFString,
  PDFContentStream,
  beginText,
  endText,
  setFontAndSize,
  showText,
  moveText,
  pushGraphicsState,
  popGraphicsState,
} from "pdf-lib";

type AuthUser = { id: string; email: string };

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const FOOTER = "Sent with AgentSign";
const ATTESTED =
  "Attested by Grok Legal for shop@example.com at 2026-08-21T12:00:00.000Z. Not an electronic signature.";

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

async function boot(now?: () => Date) {
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
    now: now ?? (() => new Date()),
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
  return key;
}

async function createNamedAgent(cookie: string, slug: string, name: string) {
  const res = await postAgents(
    new Request("http://sign.test/v1/agents", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ slug, name }),
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; slug: string; key: string };
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

function tokenFromUrl(signUrl: string) {
  return signUrl.replace(/^\/s\//, "");
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

async function verifyPdf(bytes: Uint8Array): Promise<Response> {
  return postVerify(
    new Request("http://sign.test/v1/verify", {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: Buffer.from(bytes),
    }),
  );
}

afterEach(() => {
  delete process.env.SIGN_FLAG_AGENT_PARTIES;
  delete process.env.SIGN_FLAG_AGENT_ONLY_ATTEST;
  resetEnvCache();
  resetDeps();
});

describe("POST /v1/verify", () => {
  it("A→H complete then verify is valid with a human signature", { timeout: 60_000 }, async () => {
    const frozen = new Date("2026-08-21T12:00:00.000Z");
    const { db, store, sent, userFor } = await boot(() => frozen);
    const { cookie } = await asPro(db, userFor);
    const agent = await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const live = await mintLive(cookie);
    const created = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${live}` },
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
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    expect(
      (
        await postAttest(
          new Request(`http://sign.test/v1/documents/${id}/attest`, {
            method: "POST",
            headers: { authorization: `Bearer ${agent.key}` },
          }),
          { params: Promise.resolve({ id }) },
        )
      ).status,
    ).toBe(200);

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
    const sign = await postSign(
      new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body }),
      { params: Promise.resolve({ token }) },
    );
    expect(sign.status).toBe(200);

    const sealed = await store.get(`${id}/sealed.pdf`);
    const cert = await store.get(`${id}/certificate.pdf`);
    expect(sealed).not.toBeNull();
    expect(cert).not.toBeNull();
    expect(latin1(sealed!)).toContain(ATTESTED);
    expect(latin1(sealed!)).not.toContain(FOOTER);
    expect(latin1(cert!)).not.toContain(FOOTER);
    expect(latin1(cert!)).toContain("human_signatures: 1");
    expect(latin1(cert!)).toContain("agent_attestations: 1");
    expect(latin1(cert!)).toContain("Agent slug: grok-legal");

    const res = await verifyPdf(sealed!);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      valid: boolean;
      code?: string;
      sha256?: string;
      document_id?: string;
      human_signatures?: number;
      agent_attestations?: number;
    };
    expect(json.valid).toBe(true);
    expect(json.code).toBeUndefined();
    expect(json.human_signatures).toBeGreaterThanOrEqual(1);
    expect(json.agent_attestations).toBeGreaterThanOrEqual(1);
    expect(json.document_id).toBe(id);
    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(json.sha256).toBe(env!.sha256);

    const tampered = Uint8Array.from(sealed!);
    tampered[80] ^= 0xff;
    const bad = await verifyPdf(tampered);
    expect(bad.status).toBe(200);
    const badJson = (await bad.json()) as { valid: boolean; code?: string };
    expect(badJson.valid).toBe(false);
    expect(badJson.code).toBe("not_our_seal");
  });

  it("A→H→A→H completes; certificate has attest + signed; verify valid", {
    timeout: 60_000,
  }, async () => {
    const frozen = new Date("2026-08-21T12:00:00.000Z");
    const { db, store, sent, userFor } = await boot(() => frozen);
    const { cookie } = await asPro(db, userFor);
    const legal = await createNamedAgent(cookie, "grok-legal", "Grok Legal");
    const ops = await createNamedAgent(cookie, "grok-ops", "Grok Ops");
    const live = await mintLive(cookie);
    const created = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${live}` },
        body: await documentBody([
          {
            name: "Grok Legal",
            email: "shop@example.com",
            kind: "agent",
            agent: "grok-legal",
          },
          { name: "Jane", email: "jane@example.com" },
          {
            name: "Grok Ops",
            email: "shop@example.com",
            kind: "agent",
            agent: "grok-ops",
          },
          { name: "Bob", email: "bob@example.com" },
        ]),
      }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    expect(
      (
        await postAttest(
          new Request(`http://sign.test/v1/documents/${id}/attest`, {
            method: "POST",
            headers: { authorization: `Bearer ${legal.key}` },
          }),
          { params: Promise.resolve({ id }) },
        )
      ).status,
    ).toBe(200);

    async function finishHuman(email: string) {
      const invite = sent.find((m) => m.to === email && /please sign/i.test(m.subject));
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
      const sign = await postSign(
        new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body }),
        { params: Promise.resolve({ token }) },
      );
      expect(sign.status).toBe(200);
      return sign;
    }

    const jane = await finishHuman("jane@example.com");
    expect(((await jane.json()) as { status: string }).status).toBe("pending");

    expect(
      (
        await postAttest(
          new Request(`http://sign.test/v1/documents/${id}/attest`, {
            method: "POST",
            headers: { authorization: `Bearer ${ops.key}` },
          }),
          { params: Promise.resolve({ id }) },
        )
      ).status,
    ).toBe(200);

    const bob = await finishHuman("bob@example.com");
    expect(((await bob.json()) as { status: string }).status).toBe("completed");

    const sealed = await store.get(`${id}/sealed.pdf`);
    const cert = await store.get(`${id}/certificate.pdf`);
    expect(sealed).not.toBeNull();
    expect(cert).not.toBeNull();
    const certText = latin1(cert!);
    expect(certText).toContain("human_signatures: 2");
    expect(certText).toContain("agent_attestations: 2");
    expect(certText).toContain("Agent slug: grok-legal");
    expect(certText).toContain("Agent slug: grok-ops");
    expect(certText).toContain("Jane");
    expect(certText).toContain("Bob");
    expect(latin1(sealed!)).toContain("Not an electronic signature.");

    const res = await verifyPdf(sealed!);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      valid: boolean;
      human_signatures?: number;
      agent_attestations?: number;
      document_id?: string;
    };
    expect(json.valid).toBe(true);
    expect(json.human_signatures).toBe(2);
    expect(json.agent_attestations).toBe(2);
    expect(json.document_id).toBe(id);
    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("completed");
  });

  it("Free sealed appearance includes Sent with AgentSign; certificate does not", {
    timeout: 60_000,
  }, async () => {
    const { store, sent } = await boot();
    const created = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        body: await documentBody([{ name: "Jane", email: "jane@example.com" }]),
      }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const otp = await postOtp(
      new Request(`http://sign.test/v1/documents/${id}/otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(otp.status).toBe(200);
    const done = (await otp.json()) as {
      signers: { sign_url: string | null }[];
    };
    const token = tokenFromUrl(done.signers[0]!.sign_url!);
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
    expect(
      (
        await postSign(
          new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body }),
          { params: Promise.resolve({ token }) },
        )
      ).status,
    ).toBe(200);

    const sealed = await store.get(`${id}/sealed.pdf`);
    const cert = await store.get(`${id}/certificate.pdf`);
    expect(latin1(sealed!)).toContain(FOOTER);
    expect(latin1(cert!)).not.toContain(FOOTER);

    const res = await verifyPdf(sealed!);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { valid: boolean; human_signatures?: number };
    expect(json.valid).toBe(true);
    expect(json.human_signatures).toBeGreaterThanOrEqual(1);
  });

  it("Pro sealed appearance does not include Sent with AgentSign", { timeout: 60_000 }, async () => {
    const { db, store, sent, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const live = await mintLive(cookie);
    const created = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${live}` },
        body: await documentBody([{ name: "Jane", email: "jane@example.com" }]),
      }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
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
    expect(
      (
        await postSign(
          new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body }),
          { params: Promise.resolve({ token }) },
        )
      ).status,
    ).toBe(200);

    const sealed = await store.get(`${id}/sealed.pdf`);
    const cert = await store.get(`${id}/certificate.pdf`);
    expect(latin1(sealed!)).not.toContain(FOOTER);
    expect(latin1(cert!)).not.toContain(FOOTER);
  });

  it("verify ignores parties typed into the original PDF", { timeout: 60_000 }, async () => {
    const p12 = makeDevP12("test");
    setDeps({ p12, p12Passphrase: "test" });
    const original = await pdfWithLiterals([
      "ceo@victim-corp.com",
      "2020-01-01T00:00:00.000Z",
      "Attested by Eve for cfo@victim-corp.com at 2019-05-05T00:00:00.000Z. Not an electronic signature.",
    ]);
    const documentId = "00000000-0000-0000-0000-000000000099";
    const signedAt = new Date("2026-08-21T12:00:00.000Z");
    const result = await completeDocumentPdf({
      original,
      appearance: {
        png,
        name: "Jane",
        email: "jane@example.com",
        signedAt,
      },
      p12,
      passphrase: "test",
      meta: {
        documentId,
        title: "Repair authorization",
        senderEmail: "shop@example.com",
        consentText: "I agree to sign this document electronically.",
        signers: [
          {
            name: "Jane",
            email: "jane@example.com",
            sentAt: signedAt,
            openedAt: signedAt,
            consentedAt: signedAt,
            signedAt,
            declinedAt: null,
            ip: null,
            ua: null,
          },
        ],
      },
    });
    const json = await verifySealedPdf(result.sealed);
    expect(json.valid).toBe(true);
    expect(json.document_id).toBe(documentId);
    expect(json.parties?.some((p) => p.email === "ceo@victim-corp.com")).toBe(false);
    expect(json.parties?.some((p) => p.email === "cfo@victim-corp.com")).toBe(false);
    expect(json.parties?.some((p) => p.email === "jane@example.com")).toBe(true);
  });

  it("bytes appended after a sealed PDF are not_our_seal", { timeout: 60_000 }, async () => {
    const p12 = makeDevP12("test");
    setDeps({ p12, p12Passphrase: "test" });
    const signedAt = new Date("2026-08-21T12:00:00.000Z");
    const result = await completeDocumentPdf({
      original: await minimalPdf(),
      appearance: {
        png,
        name: "Jane",
        email: "jane@example.com",
        signedAt,
      },
      p12,
      passphrase: "test",
      meta: {
        documentId: "00000000-0000-0000-0000-000000000098",
        title: "Repair authorization",
        senderEmail: "shop@example.com",
        consentText: "I agree to sign this document electronically.",
        signers: [
          {
            name: "Jane",
            email: "jane@example.com",
            sentAt: signedAt,
            openedAt: signedAt,
            consentedAt: signedAt,
            signedAt,
            declinedAt: null,
            ip: null,
            ua: null,
          },
        ],
      },
    });
    const extra = Buffer.from(
      "(ceo@victim-corp.com) (2020-01-01T00:00:00.000Z)",
      "latin1",
    );
    const tampered = Buffer.concat([Buffer.from(result.sealed), extra]);
    const json = await verifySealedPdf(tampered);
    expect(json.valid).toBe(false);
    expect(json.code).toBe("not_our_seal");
  });
});

async function pdfWithLiterals(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(PageSizes.Letter);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  let y = 720;
  for (const text of lines) {
    const stream = PDFContentStream.of(
      doc.context.obj({}),
      [
        pushGraphicsState(),
        beginText(),
        setFontAndSize(fontKey, 12),
        moveText(72, y),
        showText(PDFString.of(text) as never),
        endText(),
        popGraphicsState(),
      ],
      false,
    );
    page.node.addContentStream(doc.context.register(stream));
    y -= 18;
  }
  return doc.save({ useObjectStreams: false });
}
