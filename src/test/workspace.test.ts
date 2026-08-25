import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { POST as postAccept } from "../../app/internal/team/accept/route.js";
import { POST as postDocument } from "../../app/v1/documents/route.js";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import { getSigningState } from "../routes/signing.js";
import { POST as postInvite } from "../../app/v1/team/invites/route.js";
import { POST as postLeave } from "../../app/v1/team/leave/route.js";
import {
  GET as getWorkspace,
  PATCH as patchWorkspace,
} from "../../app/v1/workspace/route.js";
import { POST as postDissolve } from "../../app/v1/workspace/dissolve/route.js";
import { GET as getExport } from "../../app/v1/workspace/export/route.js";
import { accounts, documents, teamMembers, templates, agents } from "../db/schema.js";
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
      async startOAuth({ redirectTo }: { redirectTo: string }) {
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
  const sent: { to: string; subject: string; text: string }[] = [];
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
  return { db, userFor, sent };
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

function workspaceReq(cookie: string, init?: RequestInit) {
  return new Request("http://sign.test/v1/workspace", {
    ...init,
    headers: { cookie, ...(init?.headers ?? {}) },
  });
}

function tokenFromMail(text: string): string {
  const m = text.match(/\/team\/accept\?token=([A-Za-z0-9_-]+)/);
  expect(m?.[1]).toBeTruthy();
  return m![1]!;
}

async function proTeam(memberEmail = "tech@example.com") {
  const ctx = await boot();
  const { cookie: ownerCookie, userId: ownerUserId } = await asPro(
    ctx.db,
    ctx.userFor,
  );
  const invited = await postInvite(
    new Request("http://sign.test/v1/team/invites", {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ email: memberEmail }),
    }),
  );
  expect(invited.status).toBe(201);
  const token = tokenFromMail(ctx.sent[0]!.text);
  const memberCookie = await magicCookie(memberEmail);
  expect(
    (
      await postAccept(
        new Request("http://sign.test/team/accept", {
          method: "POST",
          headers: { cookie: memberCookie, "content-type": "application/json" },
          body: JSON.stringify({ token }),
        }),
      )
    ).status,
  ).toBe(200);
  return {
    ...ctx,
    ownerCookie,
    memberCookie,
    ownerUserId,
    memberUserId: ctx.userFor(memberEmail).id,
  };
}

describe("workspace API", () => {
  it("GET returns name, timezone, description, and app id for a free owner", async () => {
    const { userFor } = await boot();
    const cookie = await magicCookie("shop@example.com");
    const res = await getWorkspace(workspaceReq(cookie));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      app_id: string;
      display_name: string | null;
      timezone: string | null;
      description: string | null;
      role: string;
      can_edit: boolean;
    };
    expect(json.app_id).toBe(userFor("shop@example.com").id);
    expect(json.display_name).toBeNull();
    expect(json.timezone).toBeNull();
    expect(json.description).toBeNull();
    expect(json.role).toBe("owner");
    expect(json.can_edit).toBe(true);
  });

  it("PATCH persists name, timezone, and description on free", async () => {
    const { db, userFor } = await boot();
    const cookie = await magicCookie("shop@example.com");
    const res = await patchWorkspace(
      workspaceReq(cookie, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          display_name: "Shop Co",
          timezone: "America/New_York",
          description: "Repair shop",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      display_name: string | null;
      timezone: string | null;
      description: string | null;
    };
    expect(json.display_name).toBe("Shop Co");
    expect(json.timezone).toBe("America/New_York");
    expect(json.description).toBe("Repair shop");
    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userFor("shop@example.com").id));
    expect(row?.displayName).toBe("Shop Co");
    expect(row?.timezone).toBe("America/New_York");
    expect(row?.description).toBe("Repair shop");
  });

  it("PATCH display_name null clears the name", async () => {
    await boot();
    const cookie = await magicCookie("shop@example.com");
    expect(
      (
        await patchWorkspace(
          workspaceReq(cookie, {
            method: "PATCH",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({ display_name: "Shop Co" }),
          }),
        )
      ).status,
    ).toBe(200);
    const res = await patchWorkspace(
      workspaceReq(cookie, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ display_name: null }),
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { display_name: string | null };
    expect(json.display_name).toBeNull();
  });

  it("PATCH rejects an unknown timezone", async () => {
    await boot();
    const cookie = await magicCookie("shop@example.com");
    const res = await patchWorkspace(
      workspaceReq(cookie, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ timezone: "Not/A_Zone" }),
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("invalid_request");
  });

  it("member cannot PATCH", async () => {
    const { memberCookie } = await proTeam();
    const res = await patchWorkspace(
      workspaceReq(memberCookie, {
        method: "PATCH",
        headers: { cookie: memberCookie, "content-type": "application/json" },
        body: JSON.stringify({ display_name: "Nope" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("export is JSON metadata without secrets or PDF bytes", async () => {
    const { db, ownerCookie, ownerUserId } = await proTeam();
    const at = new Date();
    await db.insert(documents).values({
      title: "Repair",
      senderEmail: "shop@example.com",
      userId: ownerUserId,
      status: "pending",
      expiresAt: at,
      shredAt: at,
      webhookUrl: "https://hooks.example/x",
      webhookSecretHash: "secret-hash",
    });
    await db.insert(templates).values({
      ownerUserId,
      createdByUserId: ownerUserId,
      title: "Packet",
      storagePath: "templates/x/original.pdf",
    });
    await db.insert(agents).values({
      ownerUserId,
      slug: "grok",
      name: "Grok",
      webhookSecretHash: "agent-secret",
    });
    const res = await getExport(
      new Request("http://sign.test/v1/workspace/export", {
        headers: { cookie: ownerCookie },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    const json = (await res.json()) as {
      workspace: { app_id: string };
      members: unknown[];
      documents: Array<{ title: string }>;
      templates: Array<{ title: string }>;
      agents: Array<{ slug: string }>;
    };
    const dumped = JSON.stringify(json);
    expect(json.workspace.app_id).toBe(ownerUserId);
    expect(json.documents.some((d) => d.title === "Repair")).toBe(true);
    expect(json.templates.some((t) => t.title === "Packet")).toBe(true);
    expect(json.agents.some((a) => a.slug === "grok")).toBe(true);
    expect(dumped).not.toMatch(/secret-hash|agent-secret|webhook_secret|storagePath|storage_path/);
  });

  it("member leave removes them; owner cannot leave", async () => {
    const { db, ownerCookie, memberCookie, memberUserId } = await proTeam();
    const ownerLeave = await postLeave(
      new Request("http://sign.test/v1/team/leave", {
        method: "POST",
        headers: { cookie: ownerCookie },
      }),
    );
    expect(ownerLeave.status).toBe(403);
    const leave = await postLeave(
      new Request("http://sign.test/v1/team/leave", {
        method: "POST",
        headers: { cookie: memberCookie },
      }),
    );
    expect(leave.status).toBe(204);
    const [row] = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, memberUserId));
    expect(row).toBeUndefined();
  });

  it("owner dissolve removes members and keeps documents", async () => {
    const { db, ownerCookie, memberUserId, ownerUserId } = await proTeam();
    const at = new Date();
    const [doc] = await db
      .insert(documents)
      .values({
        title: "Keep me",
        senderEmail: "shop@example.com",
        userId: ownerUserId,
        status: "pending",
        expiresAt: at,
        shredAt: at,
      })
      .returning();
    const res = await postDissolve(
      new Request("http://sign.test/v1/workspace/dissolve", {
        method: "POST",
        headers: { cookie: ownerCookie },
      }),
    );
    expect(res.status).toBe(204);
    const members = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.ownerUserId, ownerUserId));
    expect(members).toHaveLength(0);
    const [still] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc!.id));
    expect(still?.title).toBe("Keep me");
    const [member] = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, memberUserId));
    expect(member).toBeUndefined();
  });
});

describe("signer-facing brand", () => {
  it("does not brand invite mail or the ceremony with a free workspace name", async () => {
    const { db, userFor, sent } = await boot();
    const cookie = await magicCookie("shop@example.com");
    const userId = userFor("shop@example.com").id;
    await db
      .update(accounts)
      .set({ displayName: "Shop Co" })
      .where(eq(accounts.userId, userId));
    const minted = await postKeys(
      new Request("http://sign.test/v1/keys", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(minted.status).toBe(201);
    const { key } = (await minted.json()) as { key: string };
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair");
    body.set("sender_email", "shop@example.com");
    body.set(
      "signers",
      JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
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
      signers?: { sign_url?: string }[];
    };
    const invite = sent.find((m) => m.to === "jane@example.com");
    expect(invite?.text).toContain("shop@example.com");
    expect(invite?.text).not.toContain("Shop Co");
    const token = json.signers?.[0]?.sign_url?.replace(/^\/s\//, "");
    expect(token).toBeTruthy();
    const state = await getSigningState(token!);
    expect(state.status).toBe(200);
    const ceremony = (await state.json()) as {
      display_name: string | null;
      has_logo: boolean;
    };
    expect(ceremony.display_name).toBeNull();
    expect(ceremony.has_logo).toBe(false);
  });
});
