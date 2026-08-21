import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { DELETE as deleteLogo } from "../../app/v1/branding/logo/route.js";
import { GET as getBranding, PUT as putBranding } from "../../app/v1/branding/route.js";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import { accounts, cabinetMembers } from "../db/schema.js";
import { setDeps } from "../lib/deps.js";
import { LOGO_MAX_BYTES } from "../lib/entitlement.js";
import { createFsStore } from "../lib/storage.js";
import { newTmpKey } from "../lib/tokens.js";
import { createTestDb } from "./db.js";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  ...Array(22).fill(0),
]);

const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38]);

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
  const { adapter, userFor } = createFakeAuth();
  setDeps({ db, store, auth: adapter });
  return { db, store, userFor };
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

function jsonPut(cookie: string, body: unknown) {
  return putBranding(
    new Request("http://sign.test/v1/branding", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function sessionGet(cookie: string, url = "http://sign.test/v1/branding") {
  return getBranding(new Request(url, { headers: { cookie } }));
}

describe("branding API", () => {
  it("free logged-in GET is 403 pro_required", async () => {
    await boot();
    const cookie = await magicCookie("shop@example.com");
    const res = await sessionGet(cookie);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("pro_required");
  });

  it("pro session PUT JSON display_name and GET match", async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const put = await jsonPut(cookie, { display_name: "Shop Co" });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      display_name: "Shop Co",
      has_logo: false,
    });
    const got = await sessionGet(cookie);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({
      display_name: "Shop Co",
      has_logo: false,
    });
  });

  it("pro PUT multipart PNG stores the blob", async () => {
    const { db, store, userFor } = await boot();
    const { cookie, userId } = await asPro(db, userFor);
    const body = new FormData();
    body.set("display_name", "Shop");
    body.set("logo", new Blob([PNG], { type: "image/png" }), "logo.png");
    const put = await putBranding(
      new Request("http://sign.test/v1/branding", {
        method: "PUT",
        headers: { cookie },
        body,
      }),
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ display_name: "Shop", has_logo: true });
    expect(await store.get(`branding/${userId}/logo`)).toEqual(PNG);
  });

  it("JPEG logo is accepted", async () => {
    const { db, store, userFor } = await boot();
    const { cookie, userId } = await asPro(db, userFor);
    const body = new FormData();
    body.set("logo", new Blob([JPEG], { type: "image/jpeg" }), "logo.jpg");
    const put = await putBranding(
      new Request("http://sign.test/v1/branding", {
        method: "PUT",
        headers: { cookie },
        body,
      }),
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ has_logo: true });
    expect(await store.get(`branding/${userId}/logo`)).toEqual(JPEG);
  });

  it("GIF logo is 400 invalid_logo", async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const body = new FormData();
    body.set("logo", new Blob([GIF], { type: "image/gif" }), "logo.gif");
    const put = await putBranding(
      new Request("http://sign.test/v1/branding", {
        method: "PUT",
        headers: { cookie },
        body,
      }),
    );
    expect(put.status).toBe(400);
    const json = (await put.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("invalid_logo");
  });

  it("logo over 256 KiB is 400 invalid_logo", async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const huge = new Uint8Array(LOGO_MAX_BYTES + 1);
    huge[0] = 0x89;
    huge[1] = 0x50;
    huge[2] = 0x4e;
    huge[3] = 0x47;
    const body = new FormData();
    body.set("logo", new Blob([huge], { type: "image/png" }), "logo.png");
    const put = await putBranding(
      new Request("http://sign.test/v1/branding", {
        method: "PUT",
        headers: { cookie },
        body,
      }),
    );
    expect(put.status).toBe(400);
    const json = (await put.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("invalid_logo");
  });

  it("DELETE /v1/branding/logo clears has_logo and blob", async () => {
    const { db, store, userFor } = await boot();
    const { cookie, userId } = await asPro(db, userFor);
    const body = new FormData();
    body.set("logo", new Blob([PNG], { type: "image/png" }), "logo.png");
    const put = await putBranding(
      new Request("http://sign.test/v1/branding", {
        method: "PUT",
        headers: { cookie },
        body,
      }),
    );
    expect(put.status).toBe(200);
    const del = await deleteLogo(
      new Request("http://sign.test/v1/branding/logo", {
        method: "DELETE",
        headers: { cookie },
      }),
    );
    expect(del.status).toBe(200);
    const got = await sessionGet(cookie);
    expect(await got.json()).toMatchObject({ has_logo: false });
    expect(await store.get(`branding/${userId}/logo`)).toBeNull();
  });

  it("live key can GET/PUT; tmp key and ?apiKey= are 401", async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
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

    const liveGet = await getBranding(
      new Request("http://sign.test/v1/branding", {
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    expect(liveGet.status).toBe(200);

    const livePut = await putBranding(
      new Request("http://sign.test/v1/branding", {
        method: "PUT",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ display_name: "Live Shop" }),
      }),
    );
    expect(livePut.status).toBe(200);
    expect(await livePut.json()).toEqual({
      display_name: "Live Shop",
      has_logo: false,
    });

    const tmp = newTmpKey();
    const tmpGet = await getBranding(
      new Request("http://sign.test/v1/branding", {
        headers: { authorization: `Bearer ${tmp.raw}` },
      }),
    );
    expect(tmpGet.status).toBe(401);
    const tmpJson = (await tmpGet.json()) as { error: string; code: string };
    expect(tmpJson.error).toBeTruthy();
    expect(tmpJson.code).toBe("unauthorized");

    const q = await getBranding(
      new Request(`http://sign.test/v1/branding?apiKey=${key}`, {
        headers: { cookie },
      }),
    );
    expect(q.status).toBe(401);
    const qJson = (await q.json()) as { error: string; code: string };
    expect(qJson.error).toBeTruthy();
    expect(qJson.code).toBe("unauthorized");
  });

  it("empty display_name clears name", async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const named = await jsonPut(cookie, { display_name: "Shop Co" });
    expect(named.status).toBe(200);
    const cleared = await jsonPut(cookie, { display_name: "" });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({
      display_name: null,
      has_logo: false,
    });
    const got = await sessionGet(cookie);
    expect(await got.json()).toEqual({
      display_name: null,
      has_logo: false,
    });
  });

  it("non-owner PUT is 403 forbidden", async () => {
    const { db, userFor } = await boot();
    const { userId: ownerId } = await asPro(db, userFor, "owner@example.com");
    const memberCookie = await magicCookie("tech@example.com");
    const memberId = userFor("tech@example.com").id;
    await db.insert(cabinetMembers).values({
      ownerUserId: ownerId,
      email: "tech@example.com",
      userId: memberId,
      status: "active",
      tokenHash: "x".repeat(64),
      invitedAt: new Date(),
      acceptedAt: new Date(),
    });

    const got = await sessionGet(memberCookie);
    expect(got.status).toBe(200);

    const put = await jsonPut(memberCookie, { display_name: "Hijack" });
    expect(put.status).toBe(403);
    const json = (await put.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("forbidden");
  });
});
