import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import LoginPage from "../../app/login/page.js";
import { POST as postPasskeyOptions } from "../../app/login/passkey/options/route.js";
import { POST as postPasskeySession } from "../../app/login/passkey/session/route.js";
import { POST as postRegisterOptions } from "../../app/auth/passkeys/options/route.js";
import {
  GET as getPasskeys,
  POST as postRegister,
} from "../../app/auth/passkeys/route.js";
import { DELETE as deletePasskey } from "../../app/auth/passkeys/[id]/route.js";
import { POST as postSignup } from "../../app/signup/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { GET as getWhoami } from "../../app/auth/whoami/route.js";
import type { PasskeyItem } from "../lib/auth/supabase.js";
import { resetDeps, setDeps } from "../lib/deps.js";
import { createTestDb } from "./db.js";

type AuthUser = { id: string; email: string };

function createFakeAuth() {
  const users = new Map<string, AuthUser>();
  const sessions = new Map<string, AuthUser>();
  const passwords = new Map<string, string>();
  const challenges = new Map<string, { kind: "auth" | "register"; user?: AuthUser }>();
  const passkeys = new Map<string, PasskeyItem[]>();

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
      async sendMagicLink() {},
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
        return { ok: true as const, ...issue(u) };
      },
      async signUp({ email, password }: { email: string; password: string }) {
        const u = userFor(email);
        passwords.set(u.email, password);
        return { ok: true as const };
      },
      async startOAuth({ redirectTo }: { redirectTo: string }) {
        return { url: redirectTo };
      },
      async userFromCookie(header: string | null) {
        if (!header) return null;
        const m = header.match(/(?:^|;\s*)sign_session=([^;]+)/);
        if (!m) return null;
        return sessions.get(m[1]!) ?? null;
      },
      async exchangeCode() {
        return null;
      },
      async startPasskeyAuthentication() {
        const challengeId = randomUUID();
        challenges.set(challengeId, { kind: "auth" });
        return {
          ok: true as const,
          challenge: {
            challengeId,
            options: { challenge: "abc", rpId: "openseal.me" },
          },
        };
      },
      async verifyPasskeyAuthentication({
        challengeId,
      }: {
        challengeId: string;
        credential: unknown;
      }) {
        const ch = challenges.get(challengeId);
        if (!ch || ch.kind !== "auth") {
          return {
            ok: false as const,
            error: "Unknown challenge",
            code: "webauthn_challenge_not_found",
          };
        }
        challenges.delete(challengeId);
        return { ok: true as const, ...issue(userFor("passkey@example.com")) };
      },
      async startPasskeyRegistration(cookieHeader: string | null) {
        const user = await this.userFromCookie(cookieHeader);
        if (!user) {
          return {
            ok: false as const,
            error: "Unauthorized",
            code: "unauthorized",
          };
        }
        const challengeId = randomUUID();
        challenges.set(challengeId, { kind: "register", user });
        return {
          ok: true as const,
          challenge: {
            challengeId,
            options: { challenge: "def", rpId: "openseal.me" },
          },
        };
      },
      async verifyPasskeyRegistration({
        cookieHeader,
        challengeId,
      }: {
        cookieHeader: string | null;
        challengeId: string;
        credential: unknown;
      }) {
        const user = await this.userFromCookie(cookieHeader);
        const ch = challenges.get(challengeId);
        if (!user || !ch || ch.kind !== "register" || ch.user?.id !== user.id) {
          return {
            ok: false as const,
            error: "Unknown challenge",
            code: "webauthn_challenge_not_found",
          };
        }
        challenges.delete(challengeId);
        const item: PasskeyItem = {
          id: randomUUID(),
          friendlyName: "Test key",
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        };
        passkeys.set(user.id, [...(passkeys.get(user.id) ?? []), item]);
        return { ok: true as const, passkey: item };
      },
      async listPasskeys(cookieHeader: string | null) {
        const user = await this.userFromCookie(cookieHeader);
        if (!user) {
          return {
            ok: false as const,
            error: "Unauthorized",
            code: "unauthorized",
          };
        }
        return { ok: true as const, passkeys: passkeys.get(user.id) ?? [] };
      },
      async deletePasskey({
        cookieHeader,
        passkeyId,
      }: {
        cookieHeader: string | null;
        passkeyId: string;
      }) {
        const user = await this.userFromCookie(cookieHeader);
        if (!user) {
          return {
            ok: false as const,
            error: "Unauthorized",
            code: "unauthorized",
          };
        }
        const next = (passkeys.get(user.id) ?? []).filter((p) => p.id !== passkeyId);
        passkeys.set(user.id, next);
        return { ok: true as const };
      },
    },
  };
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

afterEach(() => {
  resetDeps();
});

describe("passkey login page", () => {
  it("offers passkey sign-in", async () => {
    const ui = await LoginPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(ui);
    expect(html).toMatch(/Sign in with passkey/i);
    expect(html).toMatch(/passkey/);
  });
});

describe("passkey sign-in", () => {
  it("starts without a session and verify issues a cookie", async () => {
    const db = await createTestDb();
    const fake = createFakeAuth();
    setDeps({ db, auth: fake.adapter });
    const start = await postPasskeyOptions();
    expect(start.status).toBe(200);
    const started = (await start.json()) as {
      challenge_id: string;
      options: { challenge: string };
    };
    expect(started.challenge_id).toBeTruthy();
    expect(started.options.challenge).toBe("abc");
    const login = await postPasskeySession(
      new Request("http://sign.test/login/passkey/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challenge_id: started.challenge_id,
          credential: { id: "cred" },
          next: "/documents",
        }),
      }),
    );
    expect(login.status).toBe(200);
    const json = (await login.json()) as { ok: boolean; next: string };
    expect(json.next).toBe("/documents");
    const cookie = cookieFrom(login);
    expect(cookie).toMatch(/sign_session=/);
    const who = await getWhoami(
      new Request("http://sign.test/auth/whoami", { headers: { cookie } }),
    );
    expect(who.status).toBe(200);
    expect(await who.json()).toEqual({ email: "passkey@example.com" });
  });

  it("rejects a missing credential and sanitizes next", async () => {
    const db = await createTestDb();
    const fake = createFakeAuth();
    setDeps({ db, auth: fake.adapter });
    const bad = await postPasskeySession(
      new Request("http://sign.test/login/passkey/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge_id: "x" }),
      }),
    );
    expect(bad.status).toBe(400);
    const start = await postPasskeyOptions();
    const started = (await start.json()) as { challenge_id: string };
    const login = await postPasskeySession(
      new Request("http://sign.test/login/passkey/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challenge_id: started.challenge_id,
          credential: { id: "cred" },
          next: "https://evil.example",
        }),
      }),
    );
    expect(login.status).toBe(200);
    const json = (await login.json()) as { next: string };
    expect(json.next).toBe("/");
  });
});

describe("passkey registration", () => {
  async function signedIn() {
    const db = await createTestDb();
    const fake = createFakeAuth();
    setDeps({ db, auth: fake.adapter });
    await postSignup(
      new Request("http://sign.test/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "shop@example.com",
          password: "correct-horse",
        }),
      }),
    );
    const login = await postLogin(
      new Request("http://sign.test/login/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "shop@example.com",
          password: "correct-horse",
        }),
      }),
    );
    return cookieFrom(login);
  }

  it("401s register and list without a session", async () => {
    setDeps({ auth: createFakeAuth().adapter });
    const start = await postRegisterOptions(
      new Request("http://sign.test/auth/passkeys/options", { method: "POST" }),
    );
    expect(start.status).toBe(401);
    const list = await getPasskeys(new Request("http://sign.test/auth/passkeys"));
    expect(list.status).toBe(401);
  });

  it("registers, lists, and deletes a passkey", async () => {
    const cookie = await signedIn();
    const start = await postRegisterOptions(
      new Request("http://sign.test/auth/passkeys/options", {
        method: "POST",
        headers: { cookie },
      }),
    );
    expect(start.status).toBe(200);
    const started = (await start.json()) as { challenge_id: string };
    const saved = await postRegister(
      new Request("http://sign.test/auth/passkeys", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          challenge_id: started.challenge_id,
          credential: { id: "cred" },
        }),
      }),
    );
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as {
      passkey: { id: string; friendly_name: string | null };
    };
    expect(body.passkey.id).toBeTruthy();
    expect(body.passkey.friendly_name).toBe("Test key");
    const list = await getPasskeys(
      new Request("http://sign.test/auth/passkeys", { headers: { cookie } }),
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { passkeys: { id: string }[] };
    expect(listed.passkeys.map((p) => p.id)).toEqual([body.passkey.id]);
    const del = await deletePasskey(
      new Request(`http://sign.test/auth/passkeys/${body.passkey.id}`, {
        method: "DELETE",
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: body.passkey.id }) },
    );
    expect(del.status).toBe(200);
    const empty = await getPasskeys(
      new Request("http://sign.test/auth/passkeys", { headers: { cookie } }),
    );
    expect(await empty.json()).toEqual({ passkeys: [] });
  });
});
