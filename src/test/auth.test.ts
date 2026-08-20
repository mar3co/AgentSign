import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import LoginPage from "../../app/login/page.js";
import Home from "../../app/page.js";
import SigningPage from "../../app/s/[token]/page.js";
import { GET as getGoogle } from "../../app/login/google/route.js";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import { GET as listEnvelopes, POST as postEnvelope } from "../../app/v1/envelopes/route.js";
import { DELETE as deleteEnvelope } from "../../app/v1/envelopes/[id]/route.js";
import { POST as postOtp } from "../../app/v1/envelopes/[id]/otp/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import {
  getAuthCallback,
  postLogin,
  postSignup,
} from "../routes/auth.js";
import { envelopes } from "../db/schema.js";
import { setDeps } from "../lib/deps.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { createFsStore } from "../lib/storage.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

type AuthUser = { id: string; email: string };

function createFakeAuth() {
  const users = new Map<string, AuthUser>();
  const sessions = new Map<string, AuthUser>();
  const codes = new Map<string, AuthUser>();
  const passwords = new Map<string, string>();

  function userFor(email: string): AuthUser {
    const e = email.toLowerCase();
    let u = users.get(e);
    if (!u) {
      u = { id: randomUUID(), email: e };
      users.set(e, u);
    }
    return u;
  }

  function issue(u: AuthUser) {
    const token = randomUUID();
    sessions.set(token, u);
    return {
      user: u,
      cookie: `sign_session=${token}; Path=/; HttpOnly`,
    };
  }

  return {
    userFor,
    adapter: {
      async sendMagicLink({ email }: { email: string }) {
        const u = userFor(email);
        codes.set(`magic:${u.email}`, u);
      },
      async signInWithPassword({
        email,
        password,
      }: {
        email: string;
        password: string;
      }) {
        const u = userFor(email);
        if (passwords.get(u.email) !== password) {
          return {
            ok: false as const,
            error: "Invalid credentials",
            code: "invalid_credentials",
          };
        }
        const issued = issue(u);
        return { ok: true as const, ...issued };
      },
      async signUp({ email, password }: { email: string; password: string }) {
        const u = userFor(email);
        passwords.set(u.email, password);
        return { ok: true as const };
      },
      async startOAuth({
        provider,
        redirectTo,
      }: {
        provider: "google" | "github";
        redirectTo: string;
      }) {
        const u = userFor(`${provider}-user@example.com`);
        const code = `oauth:${provider}:${u.email}`;
        codes.set(code, u);
        const url = new URL(redirectTo);
        url.searchParams.set("code", code);
        return { url: url.toString() };
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
        return issue(u);
      },
    },
  };
}

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function mintWithCookie(cookie: string) {
  const res = await postKeys(
    new Request("http://sign.test/v1/keys", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
      },
      body: "{}",
    }),
  );
  expect(res.status).toBe(201);
  const json = (await res.json()) as { key: string };
  expect(json.key).toMatch(/^sign_live_/);
  return json.key;
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

describe("login", () => {
  it("honors email and next, uses shadcn fields, and does not add a drop form", async () => {
    const ui = await LoginPage({
      searchParams: Promise.resolve({
        email: "jane@example.com",
        next: "/envelopes",
      }),
    });
    const html = renderToStaticMarkup(ui);
    expect(html).toContain('id="email"');
    expect(html).toContain("jane@example.com");
    expect(html).not.toMatch(/type="file"/);
    expect(html).toContain("/login/google");
    expect(html).toContain("next=");
    expect(html).toContain("/login/github");
    expect(html).toMatch(/Email me a link/i);
  });

  it("GET / still has the drop form without a session cookie", async () => {
    const html = renderToStaticMarkup(createElement(Home));
    expect(html).toMatch(/type="file"/);
    expect(html).toContain('href="/login"');
    expect(html).toMatch(/>Send</);
  });

  it("password signup + sign-in yields a session that can mint a live key", async () => {
    const db = await createTestDb();
    const fake = createFakeAuth();
    setDeps({ db, auth: fake.adapter });
    const signup = await postSignup(
      new Request("http://sign.test/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "shop@example.com",
          password: "correct-horse",
        }),
      }),
    );
    expect(signup.status).toBe(200);
    expect(signup.headers.get("set-cookie")).toBeNull();
    const login = await postLogin(
      new Request("http://sign.test/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "shop@example.com",
          password: "correct-horse",
        }),
      }),
    );
    expect(login.status).toBe(200);
    const cookie = cookieFrom(login);
    expect(cookie).toMatch(/sign_session=/);
    await mintWithCookie(cookie);
  });

  it("Google OAuth start yields a session that can mint a live key", async () => {
    const db = await createTestDb();
    const fake = createFakeAuth();
    setDeps({ db, auth: fake.adapter });
    const start = await getGoogle(
      new Request("http://sign.test/login/google?next=/envelopes"),
    );
    expect(start.status).toBe(302);
    const loc = start.headers.get("location");
    expect(loc).toBeTruthy();
    const cb = await getAuthCallback(new Request(loc!));
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/envelopes");
    const cookie = cookieFrom(cb);
    expect(cookie).toMatch(/sign_session=/);
    await mintWithCookie(cookie);
    expect(fake.userFor("google-user@example.com").id).toBeTruthy();
  });

  it("signer /s/:token has no login wall before Finish; after complete, signer login lists and cannot DELETE", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const fake = createFakeAuth();
    setDeps({
      db,
      store,
      auth: fake.adapter,
      mailer: { sendMail: async (m) => { sent.push(m); } },
      p12: makeDevP12("test"),
      p12Passphrase: "test",
    });
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const created = await postEnvelope(
      new Request("http://sign.test/v1/envelopes", { method: "POST", body }),
    );
    expect(created.status).toBe(201);
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
    expect(verify.status).toBe(200);
    const done = (await verify.json()) as {
      signers: { sign_url: string | null }[];
    };
    const token = done.signers[0]!.sign_url!.replace(/^\/s\//, "");

    const ui = await SigningPage({ params: Promise.resolve({ token }) });
    const html = renderToStaticMarkup(ui);
    expect(html).toMatch(/Finish/i);
    expect(html).not.toMatch(/Keep it in a cabinet/i);
    expect(html).not.toMatch(/id="email"/);
    expect(html).not.toMatch(/href="\/login"/);

    const consent = await postConsent(
      new Request(`http://sign.test/s/${token}/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(consent.status).toBe(200);
    const signBody = new FormData();
    signBody.set("png", new Blob([png], { type: "image/png" }), "sig.png");
    const sign = await postSign(
      new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body: signBody }),
      { params: Promise.resolve({ token }) },
    );
    expect(sign.status).toBe(200);

    const magic = await postLogin(
      new Request("http://sign.test/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "jane@example.com" }),
      }),
    );
    expect(magic.status).toBe(200);
    const before = await db.select().from(envelopes).where(eq(envelopes.id, id));
    expect(before[0]!.userId).toBeNull();
    const cb = await getAuthCallback(
      new Request("http://sign.test/auth/callback?code=magic:jane@example.com"),
    );
    const cookie = cookieFrom(cb);
    const list = await listEnvelopes(
      new Request("http://sign.test/v1/envelopes", { headers: { cookie } }),
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { envelopes: { id: string }[] };
    expect(listed.envelopes.some((e) => e.id === id)).toBe(true);
    const after = await db.select().from(envelopes).where(eq(envelopes.id, id));
    expect(after[0]!.userId).toBeNull();

    const del = await deleteEnvelope(
      new Request(`http://sign.test/v1/envelopes/${id}`, {
        method: "DELETE",
        headers: { cookie },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(del.status).toBe(403);
    const err = (await del.json()) as { error: string; code: string };
    expect(err.error).toBeTruthy();
    expect(err.code).toBeTruthy();
  });
});
