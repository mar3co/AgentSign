import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { POST as postDocument } from "../../app/v1/documents/route.js";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import { signers as signersTable } from "../db/schema.js";
import { resetEnvCache } from "../env.js";
import { resetDeps, setDeps } from "../lib/deps.js";
import {
  ceremonyCsp,
  ceremonyFrameHeaders,
  parseEmbedOrigin,
} from "../lib/embed.js";
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

async function bootAuth() {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const sent: { to: string; subject: string; text: string }[] = [];
  const { adapter } = createFakeAuth();
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
  return { db, sent };
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

afterEach(() => {
  resetEnvCache();
  resetDeps();
});

describe("embed helpers", () => {
  it("embed_origin localhost http is ok; path is not", () => {
    expect(parseEmbedOrigin("http://localhost:3000").ok).toBe(true);
    expect(parseEmbedOrigin("https://app.example.com/path").ok).toBe(false);
  });

  it("ceremonyCsp includes the embed origin", () => {
    expect(ceremonyCsp("https://app.example.com")).toContain(
      "https://app.example.com",
    );
    expect(ceremonyCsp(null)).toBe("frame-ancestors 'self'");
  });

  it("ceremonyFrameHeaders sets X-Frame-Options only without embed origin", () => {
    const selfHeaders = new Headers(ceremonyFrameHeaders(null));
    expect(selfHeaders.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'self'",
    );
    expect(selfHeaders.get("X-Frame-Options")).toBe("SAMEORIGIN");

    const embedHeaders = new Headers(
      ceremonyFrameHeaders("https://app.example.com"),
    );
    expect(embedHeaders.get("Content-Security-Policy")).toContain(
      "https://app.example.com",
    );
    expect(embedHeaders.get("X-Frame-Options")).toBeNull();
  });
});

describe("create embed options", () => {
  it("send_email false mints URLs and does not send invite mail", async () => {
    const { db, sent } = await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set(
      "signers",
      JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
    );
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
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
    expect(rows[0]!.tokenEnc).toBeTruthy();
  });

  it("completed_redirect_url to http is 400", async () => {
    await bootAuth();
    const cookie = await magicCookie("shop@example.com");
    const key = await mintLive(cookie);
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set(
      "signers",
      JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
    );
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
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
});
