import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GET as getLlms } from "../../app/llms.txt/route.js";
import { GET as getOpenApi } from "../../app/openapi.json/route.js";
import { openapi } from "../openapi.js";
import { POST as postMcp } from "../../app/mcp/route.js";
import { POST as postOtp } from "../../app/v1/envelopes/[id]/otp/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { setDeps } from "../lib/deps.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { createFsStore } from "../lib/storage.js";
import { createSignMcpServer } from "../mcp/server.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

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

async function connectMcp() {
  const server = createSignMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "sign-test", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe("MCP send/status/download + OpenAPI + llms.txt", () => {
  it("GET /llms.txt lists the three tools and human always signs", async () => {
    const res = await getLlms(new Request("http://sign.test/llms.txt"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/send/);
    expect(body).toMatch(/status/);
    expect(body).toMatch(/download/);
    expect(body.toLowerCase()).toMatch(/human always signs/);
  });

  it("GET /openapi.json lists the five HTTP paths", async () => {
    const res = await getOpenApi(new Request("http://sign.test/openapi.json"));
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(spec.paths["/v1/envelopes"]?.post).toBeTruthy();
    expect(spec.paths["/v1/envelopes"]?.get).toBeTruthy();
    expect(spec.paths["/v1/envelopes/{id}"]?.get).toBeTruthy();
    expect(spec.paths["/v1/envelopes/{id}"]?.delete).toBeTruthy();
    expect(spec.paths["/v1/envelopes/{id}.pdf"]?.get).toBeTruthy();
    const dumped = JSON.stringify(spec);
    expect(dumped).toMatch(/bearer/i);
    expect(dumped).toContain("error");
    expect(dumped).toContain("code");
  });

  it("documents v1.1 rest and keeps three MCP tools", async () => {
    expect(openapi.info.version).toBe("1.1.0");
    expect(openapi.paths["/v1/branding"]).toBeTruthy();
    expect(openapi.paths["/v1/packets"]).toBeTruthy();
    expect(openapi.paths["/v1/team"]).toBeTruthy();
    const text = await (await getLlms()).text();
    expect(text).toMatch(/send/);
    expect(text).toMatch(/There is no sign/);
    expect(text).toMatch(/\/v1\/packets/);
  });

  it("POST /mcp Streamable HTTP uses protocolVersion 2025-11-25 and lists three tools", async () => {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
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
    expect(toolsBody.result?.tools).toHaveLength(3);
    expect(toolsBody.result?.tools?.map((t) => t.name).sort()).toEqual([
      "download",
      "send",
      "status",
    ]);
  });

  it(
    "registers three tools; send then status then download returns %PDF",
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
      expect(listed.tools).toHaveLength(3);
      expect(listed.tools.map((t) => t.name).sort()).toEqual([
        "download",
        "send",
        "status",
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
        new Request(`http://sign.test/v1/envelopes/${sendJson.id}/otp`, {
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
      const pdfText = textOf(download as { content: Array<{ type: string; text?: string }> });
      expect(pdfText.startsWith("%PDF")).toBe(true);
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
});
