import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AgentsList } from "../../app/agents/agents-list.js";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { POST as postAccept } from "../../app/internal/team/accept/route.js";
import { POST as postInvite } from "../../app/v1/team/invites/route.js";
import { GET as listAgents, POST as postAgents } from "../../app/v1/agents/route.js";
import { DELETE as deleteAgent } from "../../app/v1/agents/[id]/route.js";
import { POST as postRotate } from "../../app/v1/agents/[id]/rotate/route.js";
import { PUT as putWebhook } from "../../app/v1/agents/[id]/webhook/route.js";
import { accounts, agents, apiKeys } from "../db/schema.js";
import { resetEnvCache } from "../env.js";
import { resetDeps, setDeps } from "../lib/deps.js";
import { sha256Hex } from "../lib/hash.js";
import { AGENT_CAP } from "../lib/entitlement.js";
import { createTestDb } from "./db.js";

type AuthUser = { id: string; email: string };

type AgentJson = {
  id: string;
  slug: string;
  name: string;
  has_webhook: boolean;
  created_at: string;
  revoked_at: string | null;
  key?: string;
  prefix?: string;
};

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
  const { adapter, userFor } = createFakeAuth();
  const sent: { to: string; subject: string; text: string }[] = [];
  setDeps({
    db,
    auth: adapter,
    mailer: {
      sendMail: async (m) => {
        sent.push(m);
      },
    },
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
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

function agentCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function createReq(cookie: string, body: unknown) {
  return new Request("http://sign.test/v1/agents", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function inviteReq(cookie: string, email: string) {
  return new Request("http://sign.test/v1/team/invites", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

function acceptReq(cookie: string, token: string) {
  return new Request("http://sign.test/team/accept", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

function tokenFromMail(text: string): string {
  const m = text.match(/\/team\/accept\?token=([A-Za-z0-9_-]+)/);
  expect(m?.[1]).toBeTruthy();
  return m![1]!;
}

afterEach(() => {
  delete process.env.SIGN_FLAG_AGENT_PARTIES;
  resetEnvCache();
  resetDeps();
});

describe("agents API", () => {
  it("Free session cannot create an agent", async () => {
    await boot();
    const cookie = await magicCookie("shop@example.com");
    const res = await postAgents(
      createReq(cookie, { slug: "grok-legal", name: "Grok Legal" }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("pro_required");
  });

  it("Pro owner mints sign_agent_ once and list omits the raw key", async () => {
    const { db, userFor } = await boot();
    const { cookie, userId } = await asPro(db, userFor);
    const created = await postAgents(
      createReq(cookie, { slug: "grok-legal", name: "Grok Legal" }),
    );
    expect(created.status).toBe(201);
    const minted = (await created.json()) as AgentJson;
    expect(minted.id).toBeTruthy();
    expect(minted.slug).toBe("grok-legal");
    expect(minted.name).toBe("Grok Legal");
    expect(minted.has_webhook).toBe(false);
    expect(minted.revoked_at).toBeNull();
    expect(minted.key).toMatch(/^sign_agent_/);
    expect(minted.prefix).toBe(minted.key!.slice(0, 12));

    const stored = await db.select().from(apiKeys);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.kind).toBe("agent");
    expect(stored[0]!.agentId).toBe(minted.id);
    expect(stored[0]!.userId).toBe(userId);
    expect(stored[0]!.tokenHash).toBe(sha256Hex(minted.key!));
    expect(JSON.stringify(stored)).not.toContain(minted.key);

    const listed = await listAgents(
      new Request("http://sign.test/v1/agents", { headers: { cookie } }),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { agents: AgentJson[] };
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({
      id: minted.id,
      slug: "grok-legal",
      name: "Grok Legal",
      has_webhook: false,
      revoked_at: null,
    });
    expect(body.agents[0]!.key).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(minted.key);
  });

  it("11th active agent is 400 agent_limit", async () => {
    const { db, userFor } = await boot();
    const { cookie, userId } = await asPro(db, userFor);
    expect(AGENT_CAP).toBe(10);
    for (let i = 0; i < AGENT_CAP; i++) {
      await db.insert(agents).values({
        ownerUserId: userId,
        slug: `agent-${i}`,
        name: `Agent ${i}`,
      });
    }
    const over = await postAgents(
      createReq(cookie, { slug: "agent-10", name: "Eleventh" }),
    );
    expect(over.status).toBe(400);
    const json = (await over.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("agent_limit");

    await db
      .update(agents)
      .set({ revokedAt: new Date() })
      .where(eq(agents.slug, "agent-0"));
    const afterRevoke = await postAgents(
      createReq(cookie, { slug: "agent-10", name: "Eleventh" }),
    );
    expect(afterRevoke.status).toBe(201);
  });

  it("member cannot revoke the owner's agent", async () => {
    const { db, userFor, sent } = await boot();
    const { cookie: ownerCookie } = await asPro(db, userFor);
    const created = await postAgents(
      createReq(ownerCookie, { slug: "grok-legal", name: "Grok Legal" }),
    );
    expect(created.status).toBe(201);
    const minted = (await created.json()) as AgentJson;

    expect((await postInvite(inviteReq(ownerCookie, "tech@example.com"))).status).toBe(
      201,
    );
    const token = tokenFromMail(sent[0]!.text);
    const memberCookie = await magicCookie("tech@example.com");
    expect((await postAccept(acceptReq(memberCookie, token))).status).toBe(200);

    const listed = await listAgents(
      new Request("http://sign.test/v1/agents", { headers: { cookie: memberCookie } }),
    );
    expect(listed.status).toBe(200);
    const listJson = (await listed.json()) as { agents: AgentJson[] };
    expect(listJson.agents.some((a) => a.id === minted.id)).toBe(true);

    const res = await deleteAgent(
      new Request(`http://sign.test/v1/agents/${minted.id}`, {
        method: "DELETE",
        headers: { cookie: memberCookie },
      }),
      agentCtx(minted.id),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("not_owner");

    const [row] = await db.select().from(agents).where(eq(agents.id, minted.id));
    expect(row!.revokedAt).toBeNull();
  });

  it("agent APIs are 403 flag_off when agent_parties is off", async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    process.env.SIGN_FLAG_AGENT_PARTIES = "0";
    resetEnvCache();
    const res = await postAgents(
      createReq(cookie, { slug: "grok-legal", name: "Grok Legal" }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("flag_off");
  });

  it("rotate issues a new key and expires the old agent key", async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const created = await postAgents(
      createReq(cookie, { slug: "ops", name: "Ops" }),
    );
    const minted = (await created.json()) as AgentJson;
    const rotated = await postRotate(
      new Request(`http://sign.test/v1/agents/${minted.id}/rotate`, {
        method: "POST",
        headers: { cookie },
      }),
      agentCtx(minted.id),
    );
    expect(rotated.status).toBe(200);
    const next = (await rotated.json()) as AgentJson;
    expect(next.key).toMatch(/^sign_agent_/);
    expect(next.key).not.toBe(minted.key);
    expect(next.prefix).toBe(next.key!.slice(0, 12));

    const keys = await db.select().from(apiKeys);
    const old = keys.find((k) => k.tokenHash === sha256Hex(minted.key!));
    const fresh = keys.find((k) => k.tokenHash === sha256Hex(next.key!));
    expect(old).toBeTruthy();
    expect(old!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(fresh).toBeTruthy();
    expect(fresh!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(next)).not.toContain(minted.key);
  });

  it("PUT webhook returns a secret once when URL is set", async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const created = await postAgents(
      createReq(cookie, { slug: "hooks", name: "Hooks" }),
    );
    const minted = (await created.json()) as AgentJson;
    const put = await putWebhook(
      new Request(`http://sign.test/v1/agents/${minted.id}/webhook`, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ webhook_url: "https://example.com/hook" }),
      }),
      agentCtx(minted.id),
    );
    expect(put.status).toBe(200);
    const secretJson = (await put.json()) as { webhook_secret?: string };
    expect(secretJson.webhook_secret).toBeTruthy();

    const [row] = await db.select().from(agents).where(eq(agents.id, minted.id));
    expect(row!.webhookUrl).toBe("https://example.com/hook");
    expect(row!.webhookSecretHash).toBeTruthy();
    expect(row!.webhookSecretHash).not.toBe(secretJson.webhook_secret);
    expect(row!.webhookSecretHash).not.toContain(secretJson.webhook_secret);

    const listed = await listAgents(
      new Request("http://sign.test/v1/agents", { headers: { cookie } }),
    );
    const body = (await listed.json()) as { agents: AgentJson[] };
    expect(body.agents[0]!.has_webhook).toBe(true);
    expect(JSON.stringify(body)).not.toContain(secretJson.webhook_secret);
  });

  it("empty webhook PUT does not clear a saved hook without clear", async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const created = await postAgents(
      createReq(cookie, { slug: "hooks", name: "Hooks" }),
    );
    const minted = (await created.json()) as AgentJson;
    const put = await putWebhook(
      new Request(`http://sign.test/v1/agents/${minted.id}/webhook`, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ webhook_url: "https://example.com/hook" }),
      }),
      agentCtx(minted.id),
    );
    expect(put.status).toBe(200);

    const empty = await putWebhook(
      new Request(`http://sign.test/v1/agents/${minted.id}/webhook`, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ webhook_url: null }),
      }),
      agentCtx(minted.id),
    );
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { code: string }).code).toBe("invalid_request");
    const [kept] = await db.select().from(agents).where(eq(agents.id, minted.id));
    expect(kept!.webhookUrl).toBe("https://example.com/hook");
    expect(kept!.webhookSecretHash).toBeTruthy();

    const cleared = await putWebhook(
      new Request(`http://sign.test/v1/agents/${minted.id}/webhook`, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ webhook_url: null, clear: true }),
      }),
      agentCtx(minted.id),
    );
    expect(cleared.status).toBe(200);
    const [gone] = await db.select().from(agents).where(eq(agents.id, minted.id));
    expect(gone!.webhookUrl).toBeNull();
    expect(gone!.webhookSecretHash).toBeNull();
  });

  it("invalid slug is 400 and duplicate slug is 409", async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const bad = await postAgents(createReq(cookie, { slug: "-Nope", name: "Nope" }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe("invalid_slug");

    const first = await postAgents(
      createReq(cookie, { slug: "grok-legal", name: "Grok Legal" }),
    );
    expect(first.status).toBe(201);
    const dup = await postAgents(
      createReq(cookie, { slug: "grok-legal", name: "Grok Legal 2" }),
    );
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { code: string }).code).toBe("slug_taken");
  });
});

describe("agents page HTML", () => {
  it("Free GET /agents contains upgrade", async () => {
    await boot();
    const cookie = await magicCookie("shop@example.com");
    const res = await listAgents(
      new Request("http://sign.test/v1/agents", { headers: { cookie } }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("pro_required");
    const html = renderToStaticMarkup(createElement(AgentsList, { entitled: false }));
    expect(html).toMatch(/upgrade/i);
    expect(html).toContain('href="/upgrade"');
    expect(html).not.toContain("Create agent");
  });

  it('Pro owner contains "Create agent"', async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const res = await listAgents(
      new Request("http://sign.test/v1/agents", { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: AgentJson[]; can_edit: boolean };
    expect(body.can_edit).toBe(true);
    const html = renderToStaticMarkup(
      createElement(AgentsList, {
        entitled: true,
        canEdit: body.can_edit,
        agents: body.agents,
      }),
    );
    expect(html).toContain("Create agent");
  });
});
