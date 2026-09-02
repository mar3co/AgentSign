import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GET as getLlms } from "../../app/llms.txt/route.js";
import { GET as getOpenApi } from "../../app/openapi.json/route.js";
import { openapi } from "../openapi.js";
import pkg from "../../package.json" with { type: "json" };
import { POST as postMcp } from "../../app/mcp/route.js";
import { POST as postOtp } from "../../app/v1/documents/[id]/otp/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { setDeps } from "../lib/deps.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { createFsStore, objectKey } from "../lib/storage.js";
import { MCP_DOWNLOAD_MAX_BYTES, createSignMcpServer } from "../mcp/server.js";
import { newLiveKey } from "../lib/tokens.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";
import { accounts, apiKeys, documents } from "../db/schema.js";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n");
}

function tokenFromUrl(signUrl: string) {
  return signUrl.replace(/^\/s\//, "");
}

type ResourceContent = {
  type: string;
  text?: string;
  resource?: { uri?: string; mimeType?: string; blob?: string };
};

/** The byte count the download tool states in its text line. */
function statedSize(result: { content: ResourceContent[] }): number {
  const match = /\((\d+) bytes\)/.exec(textOf(result));
  if (!match) throw new Error("no byte count in text content");
  return Number(match[1]);
}

function resourceOf(result: { content: ResourceContent[] }) {
  const resource = result.content.find((c) => c.type === "resource")?.resource;
  if (!resource) throw new Error("no resource content item");
  return resource;
}

async function connectMcp() {
  const server = createSignMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "sign-test", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("MCP send/status/download + OpenAPI + llms.txt", () => {
  it("GET /llms.txt lists MCP tools and human always signs", async () => {
    const res = await getLlms(new Request("http://sign.test/llms.txt"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("AgentSign");
    expect(body).toMatch(/attest/);
    expect(body).not.toMatch(/AI signed/i);
    expect(body).toMatch(/send/);
    expect(body).toMatch(/status/);
    expect(body).toMatch(/download/);
    expect(body).toMatch(/verify/);
    expect(body).toMatch(/list_templates/);
    expect(body).toMatch(/send_template/);
    expect(body.toLowerCase()).toMatch(/human always signs/);
    expect(body).toMatch(/No sign tool/);
    expect(body).not.toMatch(/^- sign —/m);
  });

  it("documents AgentSign in OpenAPI and MCP server metadata", async () => {
    expect(openapi.info.title).toBe("AgentSign");
    const { client, server } = await connectMcp();
    void server;
    const init = await client.getServerVersion();
    expect(init?.name).toBe("agentsign");
    // Both surfaces read package.json, so the handshake and the spec agree.
    expect(init?.version).toBe(pkg.version);
    expect(openapi.info.version).toBe(pkg.version);
  });

  it("GET /openapi.json lists the core document/agent/verify paths", async () => {
    const res = await getOpenApi(new Request("http://sign.test/openapi.json"));
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(spec.paths["/v1/documents"]?.post).toBeTruthy();
    expect(spec.paths["/v1/documents"]?.get).toBeTruthy();
    expect(spec.paths["/v1/documents/{id}"]?.get).toBeTruthy();
    expect(spec.paths["/v1/documents/{id}"]?.delete).toBeTruthy();
    expect(spec.paths["/v1/documents/{id}.pdf"]?.get).toBeTruthy();
    expect(spec.paths["/v1/documents/{id}/attest"]?.post).toBeTruthy();
    expect(spec.paths["/v1/documents/{id}/reject"]?.post).toBeTruthy();
    expect(spec.paths["/v1/verify"]?.post).toBeTruthy();
    expect(spec.paths["/v1/agents"]?.get).toBeTruthy();
    expect(spec.paths["/v1/agents"]?.post).toBeTruthy();
    const dumped = JSON.stringify(spec);
    expect(dumped).toMatch(/bearer/i);
    expect(dumped).toContain("error");
    expect(dumped).toContain("code");
  });

  it("documents v1.2 rest and MCP tools without a sign tool", async () => {
    expect(openapi.info.version).toBe(pkg.version);
    expect(openapi.openapi).toBe("3.1.0");
    expect(openapi.paths["/v1/branding"]).toBeTruthy();
    expect(openapi.paths["/v1/templates"]).toBeTruthy();
    expect(openapi.paths["/v1/team"]).toBeTruthy();
    expect(openapi.paths["/v1/agents"]).toBeTruthy();
    expect(openapi.paths["/v1/documents/{id}/attest"]).toBeTruthy();
    expect(openapi.paths["/v1/documents/{id}/reject"]).toBeTruthy();
    expect(openapi.paths["/v1/verify"]).toBeTruthy();
    expect(openapi.paths["/v1/workspace"]).toBeTruthy();
    expect(openapi.paths["/v1/billing"]).toBeTruthy();
    expect(openapi.paths["/v1/billing/domain"]).toBeFalsy();
    expect(openapi.paths["/v1/billing/domain/verify"]).toBeFalsy();
    expect(openapi.paths["/s/{token}/preview"]).toBeTruthy();
    const text = await (await getLlms()).text();
    expect(text).toMatch(/send/);
    expect(text).toMatch(/There is no sign/);
    expect(text).toMatch(/\/v1\/templates/);
    expect(text).toMatch(/\/v1\/agents/);
    expect(text).not.toMatch(/\/v1\/billing\/domain/);
    expect(text).not.toMatch(/Optional Bearer tmp or live key/);
    expect(text).toMatch(/sign_tmp_/);
    expect(text).toMatch(/embed_origin/);
    expect(text).toMatch(/\{\{sig\}\}/);
    expect(text).toMatch(/send_email/);
    const bearer = openapi.components.securitySchemes.bearerAuth.description;
    expect(bearer).not.toMatch(/Optional on POST \/v1\/documents/);
    expect(bearer).toMatch(/sign_tmp_/);
    expect(bearer.toLowerCase()).toMatch(/list/);
  });

  it("tools/list includes attest and verify and list_templates, not sign", async () => {
    const { client } = await connectMcp();
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    expect(names).toContain("attest");
    expect(names).toContain("verify");
    expect(names).toContain("list_templates");
    expect(names).not.toContain("sign");
  });

  it("send_template signers are name and email only; send may include kind/agent", async () => {
    const { client } = await connectMcp();
    const listed = await client.listTools();
    const send = listed.tools.find((t) => t.name === "send");
    const template = listed.tools.find((t) => t.name === "send_template");
    const names = listed.tools.map((t) => t.name);
    expect(names).not.toContain("sign");
    const templateSchema = JSON.stringify(template?.inputSchema);
    expect(templateSchema).not.toMatch(/"kind"/);
    expect(templateSchema).not.toMatch(/"agent"/);
    expect(templateSchema).not.toMatch(/"fields"/);
    expect(templateSchema).toMatch(/"values"/);
    expect(templateSchema).toMatch(/"send_email"/);
    expect(templateSchema).toMatch(/"embed_origin"/);
    const sendSchema = JSON.stringify(send?.inputSchema);
    expect(sendSchema).toMatch(/"kind"/);
    expect(sendSchema).toMatch(/"agent"/);
    expect(sendSchema).toMatch(/"fields"/);
    expect(sendSchema).toMatch(/"values"/);
    expect(sendSchema).toMatch(/"order"/);
    expect(sendSchema).toMatch(/"send_email"/);
    expect(sendSchema).toMatch(/"completed_redirect_url"/);
    expect(sendSchema).toMatch(/"embed_origin"/);
  });

  it(
    "send with fields JSON stores them for status",
    { timeout: 60_000 },
    async () => {
      const db = await createTestDb();
      const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
      const sent: { to: string; subject: string; text: string }[] = [];
      setDeps({
        db,
        store,
        mailer: { sendMail: async (m) => { sent.push(m); } },
        p12: makeDevP12("test"),
        p12Passphrase: "test",
      });

      const { client } = await connectMcp();
      const pdf = await minimalPdf();
      const fields = JSON.stringify([
        {
          name: "sig",
          type: "signature",
          role: "Signer 1",
          required: true,
          readonly: false,
          areas: [{ page: 1, x: 10, y: 20, w: 30, h: 8 }],
        },
      ]);
      const sendResult = await client.callTool({
        name: "send",
        arguments: {
          title: "Fielded authorization",
          sender_email: "shop@example.com",
          signers: [{ name: "Jane", email: "jane@example.com" }],
          pdf: Buffer.from(pdf).toString("base64"),
          fields,
        },
      });
      const sendText = textOf(sendResult as { content: Array<{ type: string; text?: string }> });
      const sendJson = JSON.parse(sendText) as { id: string; status: string };
      expect(sendJson.id).toBeTruthy();
      expect(sendJson.status).toBe("pending_sender");

      const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
      const verify = await postOtp(
        new Request(`http://sign.test/v1/documents/${sendJson.id}/otp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        }),
        { params: Promise.resolve({ id: sendJson.id }) },
      );
      expect(verify.status).toBe(200);
      const done = (await verify.json()) as { key: string };
      const statusResult = await client.callTool({
        name: "status",
        arguments: { id: sendJson.id, api_key: done.key },
      });
      const statusText = textOf(
        statusResult as { content: Array<{ type: string; text?: string }> },
      );
      const statusJson = JSON.parse(statusText) as { fields: { name: string }[] };
      expect(statusJson.fields.some((f) => f.name === "sig")).toBe(true);
    },
  );

  it(
    "send passes message through to the document",
    { timeout: 60_000 },
    async () => {
      const db = await createTestDb();
      const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
      const sent: { to: string; subject: string; text: string }[] = [];
      setDeps({
        db,
        store,
        mailer: { sendMail: async (m) => { sent.push(m); } },
        p12: makeDevP12("test"),
        p12Passphrase: "test",
      });

      const { client } = await connectMcp();
      const pdf = await minimalPdf();
      const sendResult = await client.callTool({
        name: "send",
        arguments: {
          title: "Authorization with message",
          sender_email: "shop@example.com",
          signers: [{ name: "Jane", email: "jane@example.com" }],
          pdf: Buffer.from(pdf).toString("base64"),
          message: "Please sign before Friday.",
        },
      });
      expect(sendResult.isError).toBeFalsy();
      const sendText = textOf(sendResult as { content: Array<{ type: string; text?: string }> });
      const { id } = JSON.parse(sendText) as { id: string };
      const [row] = await db.select().from(documents).where(eq(documents.id, id));
      expect(row!.message).toBe("Please sign before Friday.");
    },
  );

  it("POST /mcp Streamable HTTP uses protocolVersion 2025-11-25 and lists MCP tools", async () => {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
      authorization: "Bearer sign_live_mcp_discovery",
    };
    const init = await postMcp(
      new Request("http://sign.test/mcp", {
        method: "POST",
        headers,
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
    expect(init.headers.get("access-control-allow-origin")).not.toBe("*");
    const initBody = (await init.json()) as {
      result?: { protocolVersion?: string };
    };
    expect(initBody.result?.protocolVersion).toBe("2025-11-25");

    const listed = await postMcp(
      new Request("http://sign.test/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      }),
    );
    const toolsBody = (await listed.json()) as {
      result?: { tools?: { name: string }[] };
    };
    expect(toolsBody.result?.tools?.map((t) => t.name).sort()).toEqual([
      "attest",
      "download",
      "list_templates",
      "reject",
      "send",
      "send_template",
      "status",
      "verify",
    ]);
    expect(toolsBody.result?.tools?.some((t) => t.name === "sign")).toBe(false);
  });

  it(
    "POST /mcp download returns a base64 PDF resource for a sign_live_ key",
    { timeout: 60_000 },
    async () => {
      const db = await createTestDb();
      const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
      const sent: { to: string; subject: string; text: string }[] = [];
      setDeps({
        db,
        store,
        mailer: { sendMail: async (m) => { sent.push(m); } },
        p12: makeDevP12("test"),
        p12Passphrase: "test",
      });

      const userId = randomUUID();
      await db.insert(accounts).values({ userId, email: "shop@example.com" });
      const live = newLiveKey();
      await db.insert(apiKeys).values({
        kind: "live",
        prefix: live.prefix,
        tokenHash: live.hash,
        userId,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
        authorization: `Bearer ${live.raw}`,
      };

      const pdf = await minimalPdf();
      const sendRes = await postMcp(
        new Request("http://sign.test/mcp", {
          method: "POST",
          headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
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
      const sendBody = (await sendRes.json()) as {
        result?: { content?: Array<{ type: string; text?: string }> };
      };
      const sendJson = JSON.parse(
        sendBody.result?.content?.find((c) => c.type === "text")?.text ?? "{}",
      ) as { id: string; status: string; signers: { sign_url: string }[] };
      expect(sendJson.status).toBe("pending");
      const documentId = sendJson.id;
      const token = tokenFromUrl(sendJson.signers[0]!.sign_url);

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
      const signed = await postSign(
        new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body: signBody }),
        { params: Promise.resolve({ token }) },
      );
      expect(signed.status).toBe(200);

      const downloadRes = await postMcp(
        new Request("http://sign.test/mcp", {
          method: "POST",
          headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "download", arguments: { id: documentId } },
          }),
        }),
      );
      const downloadBody = (await downloadRes.json()) as {
        result?: { content?: ResourceContent[]; isError?: boolean };
      };
      expect(downloadBody.result?.isError).toBeFalsy();
      const resource = resourceOf({ content: downloadBody.result?.content ?? [] });
      expect(resource.mimeType).toBe("application/pdf");
      expect(resource.uri).toBe(`agentsign://documents/${documentId}.pdf`);
      const pdfBytes = Buffer.from(resource.blob!, "base64");
      expect(pdfBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
      const sealed = await store.get(objectKey(documentId, "sealed"));
      expect(sealed).not.toBeNull();
      expect(pdfBytes.equals(Buffer.from(sealed!))).toBe(true);
      expect(statedSize({ content: downloadBody.result?.content ?? [] })).toBe(
        pdfBytes.byteLength,
      );

      const oversized = MCP_DOWNLOAD_MAX_BYTES + 1;
      await store.put(objectKey(documentId, "sealed"), new Uint8Array(oversized));
      const tooBigRes = await postMcp(
        new Request("http://sign.test/mcp", {
          method: "POST",
          headers,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "download", arguments: { id: documentId } },
          }),
        }),
      );
      const tooBigBody = (await tooBigRes.json()) as {
        result?: { content?: ResourceContent[]; isError?: boolean };
      };
      expect(tooBigBody.result?.isError).toBe(true);
      expect(
        tooBigBody.result?.content?.some((c) => c.type === "resource"),
      ).toBeFalsy();
      const tooBigText = textOf({ content: tooBigBody.result?.content ?? [] });
      expect(tooBigText).toContain("too large for MCP");
      expect(tooBigText).toContain(`/v1/documents/${documentId}.pdf`);
      expect(tooBigText).toContain(String(oversized));
    },
  );

  it(
    "registers MCP tools; send then status then download returns %PDF",
    { timeout: 60_000 },
    async () => {
      const db = await createTestDb();
      const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
      const sent: { to: string; subject: string; text: string }[] = [];
      setDeps({
        db,
        store,
        mailer: { sendMail: async (m) => { sent.push(m); } },
        p12: makeDevP12("test"),
        p12Passphrase: "test",
      });

      const { client } = await connectMcp();
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name).sort()).toEqual([
        "attest",
        "download",
        "list_templates",
        "reject",
        "send",
        "send_template",
        "status",
        "verify",
      ]);
      expect(listed.tools.some((t) => t.name === "sign")).toBe(false);
      expect(listed.tools.some((t) => t.name === "complete")).toBe(false);
      expect(listed.tools.some((t) => t.name === "create_template")).toBe(false);

      const pdf = await minimalPdf();
      const sendResult = await client.callTool({
        name: "send",
        arguments: {
          title: "Repair authorization",
          sender_email: "shop@example.com",
          signers: [{ name: "Jane", email: "jane@example.com" }],
          pdf: Buffer.from(pdf).toString("base64"),
        },
      });
      const sendText = textOf(sendResult as { content: Array<{ type: string; text?: string }> });
      expect(sendText.toLowerCase()).toMatch(/email/);
      const sendJson = JSON.parse(sendText) as { id: string; status: string; message?: string };
      expect(sendJson.id).toBeTruthy();
      expect(sendJson.status).toBe("pending_sender");
      expect((sendJson.message ?? sendText).toLowerCase()).toMatch(/email/);

      const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
      const verify = await postOtp(
        new Request(`http://sign.test/v1/documents/${sendJson.id}/otp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        }),
        { params: Promise.resolve({ id: sendJson.id }) },
      );
      expect(verify.status).toBe(200);
      const done = (await verify.json()) as {
        key: string;
        signers: { sign_url: string | null }[];
      };
      const key = done.key;
      const token = tokenFromUrl(done.signers[0]!.sign_url!);

      const statusResult = await client.callTool({
        name: "status",
        arguments: { id: sendJson.id, api_key: key },
      });
      const statusText = textOf(
        statusResult as { content: Array<{ type: string; text?: string }> },
      );
      expect(statusText).toContain(sendJson.id);
      expect(statusText).toMatch(/pending/);

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
      const signed = await postSign(
        new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body: signBody }),
        { params: Promise.resolve({ token }) },
      );
      expect(signed.status).toBe(200);

      const download = await client.callTool({
        name: "download",
        arguments: { id: sendJson.id, api_key: key },
      });
      expect((download as { isError?: boolean }).isError).toBeFalsy();
      const resource = resourceOf(download as { content: ResourceContent[] });
      expect(resource.mimeType).toBe("application/pdf");
      expect(resource.uri).toBe(`agentsign://documents/${sendJson.id}.pdf`);
      const pdfBytes = Buffer.from(resource.blob!, "base64");
      expect(pdfBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
      const sealed = await store.get(objectKey(sendJson.id, "sealed"));
      expect(sealed).not.toBeNull();
      expect(pdfBytes.equals(Buffer.from(sealed!))).toBe(true);
      expect(statedSize(download as { content: ResourceContent[] })).toBe(
        pdfBytes.byteLength,
      );
    },
  );

  it("HTTP POST /mcp does not use SIGN_API_KEY when no Bearer is sent", async () => {
    const prev = process.env.SIGN_API_KEY;
    process.env.SIGN_API_KEY = "sign_live_should_not_count";
    try {
      const res = await postMcp(
        new Request("http://sign.test/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-11-25",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "status", arguments: { id: "00000000-0000-0000-0000-000000000001" } },
          }),
        }),
      );
      const body = await res.text();
      expect(body.toLowerCase()).toMatch(/unauthor|api key|unauthorized|missing/);
      expect(body).not.toContain("sign_live_should_not_count");
    } finally {
      if (prev === undefined) delete process.env.SIGN_API_KEY;
      else process.env.SIGN_API_KEY = prev;
    }
  });

  it("send accepts markdown instead of pdf", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    setDeps({
      db,
      store,
      mailer: { sendMail: async (m) => { sent.push(m); } },
    });
    const { client } = await connectMcp();
    const result = await client.callTool({
      name: "send",
      arguments: {
        title: "Markdown authorization",
        sender_email: "shop@example.com",
        signers: [{ name: "Jane", email: "jane@example.com" }],
        markdown: "# Authorization\n\nSign below.\n\n{{sig}}",
      },
    });
    const json = JSON.parse(
      textOf(result as { content: Array<{ type: string; text?: string }> }),
    ) as { id?: string; status?: string };
    expect(json.id).toBeTruthy();
    expect(json.status).toBe("pending_sender");
  });

  it("send with neither pdf nor markdown is an error", async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    setDeps({ db, store, mailer: { sendMail: async () => {} } });
    const { client } = await connectMcp();
    const result = await client.callTool({
      name: "send",
      arguments: {
        title: "No content",
        sender_email: "shop@example.com",
        signers: [{ name: "Jane", email: "jane@example.com" }],
      },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = textOf(result as { content: Array<{ type: string; text?: string }> });
    expect(text).toMatch(/markdown|pdf/i);
  });

  it("send schema includes markdown and pdf is optional", async () => {
    const { client } = await connectMcp();
    const listed = await client.listTools();
    const send = listed.tools.find((t) => t.name === "send");
    const schema = send?.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.properties?.markdown).toBeTruthy();
    expect(schema.required ?? []).not.toContain("pdf");
    expect(schema.required ?? []).not.toContain("markdown");
  });

  it("MCP verify rate limits per client IP, not one bucket for every caller", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    setDeps({ db, store, mailer: { sendMail: async () => {} } });
    async function verifyFrom(ip: string, id: number) {
      const res = await postMcp(
        new Request("http://sign.test/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-11-25",
            authorization: "Bearer sign_live_mcp_discovery",
            "x-real-ip": ip,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: {
              name: "verify",
              arguments: { pdf: Buffer.from("not a pdf").toString("base64") },
            },
          }),
        }),
      );
      return JSON.stringify(await res.json());
    }
    for (let i = 0; i < 30; i++) {
      expect(await verifyFrom("203.0.113.60", i + 1)).not.toContain("rate_limited");
    }
    expect(await verifyFrom("203.0.113.60", 31)).toContain("rate_limited");
    expect(await verifyFrom("203.0.113.61", 32)).not.toContain("rate_limited");
  });
});
