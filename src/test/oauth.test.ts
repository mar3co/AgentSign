import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { POST as postAgents } from "../../app/v1/agents/route.js";
import { POST as postAttest } from "../../app/v1/envelopes/[id]/attest/route.js";
import { POST as postEnvelope } from "../../app/v1/envelopes/route.js";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import { accounts, signers as signersTable } from "../db/schema.js";
import { appOrigin, resetEnvCache } from "../env.js";
import { resetDeps, setDeps } from "../lib/deps.js";
import { fetchClientMetadata, pkceS256 } from "../lib/oauth.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { createFsStore } from "../lib/storage.js";
import { handleMcpHttp } from "../mcp/server.js";
import { postAuthorize, postRegister, postToken } from "../routes/oauth.js";
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

async function boot() {
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

function mcpResource(): string {
  return `${appOrigin()}/mcp`;
}

function pkcePair() {
  const verifier = `a${"b".repeat(42)}`;
  return { verifier, challenge: pkceS256(verifier) };
}

async function registerPublicClient(redirectUri: string, name = "Test MCP") {
  const res = await postRegister(
    new Request("http://sign.test/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
      }),
    }),
  );
  expect(res.status).toBe(201);
  const json = (await res.json()) as {
    client_id: string;
    token_endpoint_auth_method?: string;
  };
  expect(json.client_id).toBeTruthy();
  expect(json.token_endpoint_auth_method).toBe("none");
  return json.client_id;
}

async function issueAccessToken(opts: {
  cookie: string;
  clientId: string;
  redirectUri: string;
  agentIds?: string[];
}) {
  const { verifier, challenge } = pkcePair();
  const resource = mcpResource();
  const authorize = await postAuthorize(
    new Request("http://sign.test/oauth/authorize", {
      method: "POST",
      headers: {
        cookie: opts.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        state: "xyz",
        code_challenge: challenge,
        resource,
        ...(opts.agentIds !== undefined ? { agent_ids: opts.agentIds } : {}),
      }),
    }),
  );
  expect(authorize.status).toBe(302);
  const location = authorize.headers.get("location");
  expect(location).toBeTruthy();
  const redirect = new URL(location!, "https://client.example");
  expect(redirect.searchParams.get("state")).toBe("xyz");
  const code = redirect.searchParams.get("code");
  expect(code).toBeTruthy();

  const tokenRes = await postToken(
    new Request("http://sign.test/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: opts.redirectUri,
        client_id: opts.clientId,
        code_verifier: verifier,
        resource,
      }).toString(),
    }),
  );
  expect(tokenRes.status).toBe(200);
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    token_type: string;
    refresh_token?: string;
    expires_in?: number;
  };
  expect(tokens.access_token).toMatch(/^sign_oauth_/);
  expect(tokens.token_type.toLowerCase()).toBe("bearer");
  return tokens.access_token;
}

afterEach(() => {
  delete process.env.APP_URL;
  delete process.env.APP_ORIGIN;
  resetEnvCache();
  resetDeps();
});

describe("MCP OAuth 2.1", () => {
  it("POST /mcp without Bearer is 401 with resource_metadata", async () => {
    const res = await handleMcpHttp(
      new Request("http://sign.test/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "sign-test", version: "0.1.0" },
          },
        }),
      }),
    );
    expect(res.status).toBe(401);
    const www = res.headers.get("www-authenticate") ?? "";
    expect(www).toMatch(/^Bearer /);
    expect(www).toContain(
      `resource_metadata="${appOrigin()}/.well-known/oauth-protected-resource"`,
    );
    expect(www).toContain('scope="send status download"');
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("PKCE authorize+token yields Bearer that can send", { timeout: 60_000 }, async () => {
    const { userFor } = await boot();
    const cookie = await magicCookie("shop@example.com");
    expect(userFor("shop@example.com").id).toBeTruthy();
    const redirectUri = "https://client.example/cb";
    const clientId = await registerPublicClient(redirectUri);
    const access = await issueAccessToken({ cookie, clientId, redirectUri });

    const pdf = await minimalPdf();
    const send = await handleMcpHttp(
      new Request("http://sign.test/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "send",
            arguments: {
              title: "Repair authorization",
              sender_email: "shop@example.com",
              signers: [{ name: "Jane", email: "jane@example.com" }],
              pdf: Buffer.from(pdf).toString("base64"),
            },
          },
        }),
      }),
    );
    expect(send.status).toBe(200);
    expect(send.headers.get("access-control-allow-origin")).not.toBe("*");
    const body = (await send.json()) as {
      result?: { content?: { type: string; text?: string }[]; isError?: boolean };
      error?: unknown;
    };
    expect(body.error).toBeFalsy();
    expect(body.result?.isError).not.toBe(true);
    const text = (body.result?.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n");
    const sent = JSON.parse(text) as { id?: string; status?: string };
    expect(sent.id).toBeTruthy();
    expect(sent.status).toBe("pending");
  });

  it(
    "OAuth grant with empty allowed_agent_ids cannot attest",
    { timeout: 60_000 },
    async () => {
      const { db, userFor } = await boot();
      const { cookie } = await asPro(db, userFor);
      const created = await postAgents(
        new Request("http://sign.test/v1/agents", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ slug: "grok-legal", name: "Grok Legal" }),
        }),
      );
      expect(created.status).toBe(201);

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
      const form = new FormData();
      form.set("title", "Repair authorization");
      form.set("sender_email", "shop@example.com");
      form.set(
        "signers",
        JSON.stringify([
          {
            name: "Grok Legal",
            email: "shop@example.com",
            kind: "agent",
            agent: "grok-legal",
          },
          { name: "Jane", email: "jane@example.com" },
        ]),
      );
      form.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
      const envRes = await postEnvelope(
        new Request("http://sign.test/v1/envelopes", {
          method: "POST",
          headers: { authorization: `Bearer ${key}` },
          body: form,
        }),
      );
      expect(envRes.status).toBe(201);
      const envelope = (await envRes.json()) as { id: string };

      const redirectUri = "https://client.example/cb";
      const clientId = await registerPublicClient(redirectUri, "Empty Grant");
      const access = await issueAccessToken({
        cookie,
        clientId,
        redirectUri,
        agentIds: [],
      });

      const attest = await postAttest(
        new Request(`http://sign.test/v1/envelopes/${envelope.id}/attest`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${access}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ agent: "grok-legal" }),
        }),
        { params: Promise.resolve({ id: envelope.id }) },
      );
      expect(attest.status).toBe(403);
      const json = (await attest.json()) as { error: string; code: string };
      expect(json.code).toBe("cannot_attest");
      expect(json.error).toBeTruthy();

      const [row] = await db
        .select()
        .from(signersTable)
        .where(eq(signersTable.envelopeId, envelope.id));
      expect(row!.attestedAt).toBeNull();
    },
  );

  it("CIMD client_id to a blocked host is rejected", async () => {
    const { userFor } = await boot();
    const cookie = await magicCookie("shop@example.com");
    expect(userFor("shop@example.com").id).toBeTruthy();

    const meta = await fetchClientMetadata(
      "https://127.0.0.1/.well-known/oauth-client",
    );
    expect("error" in meta).toBe(true);
    if ("error" in meta) expect(meta.error).toBeTruthy();

    const blocked = await postAuthorize(
      new Request("http://sign.test/oauth/authorize", {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_id: "https://127.0.0.1/client.json",
          redirect_uri: "https://example.com/cb",
          state: "x",
          code_challenge: pkceS256("c".repeat(43)),
          resource: mcpResource(),
        }),
      }),
    );
    expect(blocked.status).toBeGreaterThanOrEqual(400);
    expect(blocked.status).toBeLessThan(500);
    const json = (await blocked.json()) as { error?: string; code?: string };
    expect(json.error).toBeTruthy();
  });
});
