import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client.js";
import { getDeps } from "../lib/deps.js";
import {
  lookupOauthGrant,
  looksLikeJwt,
  mcpResource,
  mcpUnauthorized,
} from "../lib/oauth.js";
import { attestEnvelope, rejectEnvelope } from "../routes/attest.js";
import {
  createEnvelope,
  getEnvelope,
  getEnvelopePdf,
} from "../routes/envelopes.js";
import { listPackets, sendPacket } from "../routes/packets.js";
import { verifyEnvelope } from "../routes/verify.js";

const signerSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  kind: z.enum(["human", "agent"]).optional(),
  agent: z.string().optional(),
});

const packetSignerSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
});

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function resolveKey(
  args: { api_key?: string },
  extra: Extra,
  allowEnvKey: boolean,
): string | null {
  const fromArgs = args.api_key?.trim();
  if (fromArgs) return fromArgs;
  const fromAuth = extra.authInfo?.token?.trim();
  if (fromAuth) return fromAuth;
  const auth = headerValue(extra.requestInfo?.headers, "authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  if (!allowEnvKey) return null;
  const envKey = process.env.SIGN_API_KEY?.trim();
  return envKey || null;
}

function toolText(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

function bearerFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

async function jsonOrText(res: Response): Promise<string> {
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    return JSON.stringify(await res.json());
  }
  return res.text();
}

export function createSignMcpServer(opts?: { allowEnvKey?: boolean }): McpServer {
  const allowEnvKey = opts?.allowEnvKey === true;
  const server = new McpServer(
    { name: "agentsign", version: "1.2.0" },
    {
      instructions:
        "AgentSign is a signing primitive. Human always signs. Keys authenticate the caller and never sign. No sign tool. Humans Finish. Agents Attest. Tools: send, status, download, attest, reject, verify, list_packets, send_packet.",
    },
  );

  server.registerTool(
    "send",
    {
      title: "Send envelope",
      description:
        "Create and send a signing envelope (POST /v1/envelopes). Pass PDF bytes as base64, not a public pdf_url. Optional Bearer sign_live_ key. Without a key, starts a sender OTP one-off — tell the operator to check sender email. sign_tmp_ cannot send or list. Signer objects may include kind (human|agent) and agent slug. No sign tool. Humans Finish. Agents Attest.",
      inputSchema: {
        title: z.string().min(1),
        sender_email: z.string().min(1),
        signers: z.array(signerSchema).min(1),
        pdf: z.string().describe("Base64-encoded PDF bytes. Not a URL."),
        api_key: z.string().optional(),
      },
    },
    async (args, extra) => {
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(Buffer.from(args.pdf, "base64"));
      } catch {
        return toolText(
          JSON.stringify({ error: "File must be a PDF", code: "invalid_pdf" }),
          true,
        );
      }
      const form = new FormData();
      form.set("title", args.title);
      form.set("sender_email", args.sender_email);
      form.set("signers", JSON.stringify(args.signers));
      form.set("file", new Blob([Buffer.from(bytes)], { type: "application/pdf" }), "document.pdf");
      const headers = new Headers();
      const key = resolveKey(args, extra, allowEnvKey);
      if (key) headers.set("authorization", `Bearer ${key}`);
      const res = await createEnvelope(
        new Request("http://sign.local/v1/envelopes", {
          method: "POST",
          headers,
          body: form,
        }),
      );
      const body = (await res.json()) as {
        id?: string;
        status?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        return toolText(JSON.stringify(body), true);
      }
      const message =
        body.status === "pending_sender"
          ? "Check sender email for a verification code. Human always signs."
          : "Envelope sent. A human must sign. Keys never sign.";
      return toolText(JSON.stringify({ ...body, message }));
    },
  );

  server.registerTool(
    "status",
    {
      title: "Envelope status",
      description:
        "GET /v1/envelopes/{id}. Requires a tmp or live Bearer key. Returns status, signers, and audit. Human always signs — this tool never completes a signature.",
      inputSchema: {
        id: z.string().min(1),
        api_key: z.string().optional(),
      },
    },
    async (args, extra) => {
      const key = resolveKey(args, extra, allowEnvKey);
      if (!key) {
        return toolText(
          JSON.stringify({ error: "Unauthorized", code: "unauthorized" }),
          true,
        );
      }
      const res = await getEnvelope(
        new Request(`http://sign.local/v1/envelopes/${args.id}`, {
          headers: { authorization: `Bearer ${key}` },
        }),
        args.id,
      );
      return toolText(await jsonOrText(res), !res.ok);
    },
  );

  server.registerTool(
    "download",
    {
      title: "Download sealed PDF",
      description:
        "GET /v1/envelopes/{id}.pdf. Requires a tmp or live Bearer key. Returns the sealed PDF after the human ceremony. 409 if not completed.",
      inputSchema: {
        id: z.string().min(1),
        api_key: z.string().optional(),
      },
    },
    async (args, extra) => {
      const key = resolveKey(args, extra, allowEnvKey);
      if (!key) {
        return toolText(
          JSON.stringify({ error: "Unauthorized", code: "unauthorized" }),
          true,
        );
      }
      const res = await getEnvelopePdf(
        new Request(`http://sign.local/v1/envelopes/${args.id}.pdf`, {
          headers: { authorization: `Bearer ${key}` },
        }),
        args.id,
      );
      if (!res.ok) {
        return toolText(await jsonOrText(res), true);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      return toolText(new TextDecoder("latin1").decode(bytes));
    },
  );

  server.registerTool(
    "attest",
    {
      title: "Attest as an agent",
      description:
        "POST /v1/envelopes/{id}/attest. Current party must be an agent this caller may use. Named-agent sign_agent_ key infers the slug; live/session must pass agent. No sign tool. Humans Finish. Agents Attest.",
      inputSchema: {
        envelope_id: z.string(),
        agent: z.string().optional(),
        api_key: z.string().optional(),
      },
    },
    async (args, extra) => {
      const headers = new Headers({ "content-type": "application/json" });
      const key = resolveKey(args, extra, allowEnvKey);
      if (key) headers.set("authorization", `Bearer ${key}`);
      const res = await attestEnvelope(
        new Request(`http://sign.local/v1/envelopes/${args.envelope_id}/attest`, {
          method: "POST",
          headers,
          body: JSON.stringify(args.agent ? { agent: args.agent } : {}),
        }),
        args.envelope_id,
      );
      return toolText(await jsonOrText(res), !res.ok);
    },
  );

  server.registerTool(
    "reject",
    {
      title: "Reject as an agent",
      description:
        "POST /v1/envelopes/{id}/reject. Agent decline for the current party. Same auth as attest. No sign tool. Humans Finish. Agents Attest.",
      inputSchema: {
        envelope_id: z.string(),
        agent: z.string().optional(),
        api_key: z.string().optional(),
      },
    },
    async (args, extra) => {
      const headers = new Headers({ "content-type": "application/json" });
      const key = resolveKey(args, extra, allowEnvKey);
      if (key) headers.set("authorization", `Bearer ${key}`);
      const res = await rejectEnvelope(
        new Request(`http://sign.local/v1/envelopes/${args.envelope_id}/reject`, {
          method: "POST",
          headers,
          body: JSON.stringify(args.agent ? { agent: args.agent } : {}),
        }),
        args.envelope_id,
      );
      return toolText(await jsonOrText(res), !res.ok);
    },
  );

  server.registerTool(
    "verify",
    {
      title: "Verify a sealed PDF",
      description:
        "POST /v1/verify. Unauthenticated. Pass sealed PDF bytes as base64. Checks our P12 seal. Does not Finish or Attest.",
      inputSchema: {
        pdf: z.string().describe("Base64-encoded PDF bytes. Not a URL."),
      },
    },
    async (args) => {
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(Buffer.from(args.pdf, "base64"));
      } catch {
        return toolText(
          JSON.stringify({ error: "A PDF is required", code: "invalid_request" }),
          true,
        );
      }
      const res = await verifyEnvelope(
        new Request("http://sign.local/v1/verify", {
          method: "POST",
          headers: { "content-type": "application/pdf" },
          body: Buffer.from(bytes),
        }),
      );
      return toolText(await jsonOrText(res), !res.ok);
    },
  );

  server.registerTool(
    "list_packets",
    {
      title: "List packets",
      description:
        "GET /v1/packets. Requires a session or sign_live_ Bearer. sign_tmp_ cannot list. Returns saved packets for the cabinet.",
      inputSchema: {
        api_key: z.string().optional(),
      },
    },
    async (args, extra) => {
      const key = resolveKey(args, extra, allowEnvKey);
      if (!key) {
        return toolText(
          JSON.stringify({ error: "Unauthorized", code: "unauthorized" }),
          true,
        );
      }
      const res = await listPackets(
        new Request("http://sign.local/v1/packets", {
          headers: { authorization: `Bearer ${key}` },
        }),
      );
      return toolText(await jsonOrText(res), !res.ok);
    },
  );

  server.registerTool(
    "send_packet",
    {
      title: "Send a packet",
      description:
        "POST /v1/packets/{id}/send. Requires a session or sign_live_ Bearer. signers.length must equal packet role count; order is signing_order. Each signer is { name, email } only — no kind/agent. Mixed parties use send. Human always signs.",
      inputSchema: {
        id: z.string().min(1),
        signers: z.array(packetSignerSchema).min(1),
        api_key: z.string().optional(),
      },
    },
    async (args, extra) => {
      const key = resolveKey(args, extra, allowEnvKey);
      if (!key) {
        return toolText(
          JSON.stringify({ error: "Unauthorized", code: "unauthorized" }),
          true,
        );
      }
      const res = await sendPacket(
        new Request(`http://sign.local/v1/packets/${args.id}/send`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ signers: args.signers }),
        }),
        args.id,
      );
      return toolText(await jsonOrText(res), !res.ok);
    },
  );

  return server;
}

export async function handleMcpHttp(req: Request): Promise<Response> {
  const raw = bearerFromRequest(req);
  if (!raw || looksLikeJwt(raw)) return mcpUnauthorized();
  if (raw.startsWith("sign_oauth_")) {
    const db = getDeps().db ?? getDb();
    const grant = await lookupOauthGrant(db, raw);
    if (!grant || grant.resource !== mcpResource()) return mcpUnauthorized();
  }

  const server = createSignMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const authInfo: AuthInfo = { token: raw, clientId: "sign", scopes: [] };
  try {
    return await transport.handleRequest(req, { authInfo });
  } finally {
    await transport.close();
    await server.close();
  }
}

export async function runStdio(): Promise<void> {
  const server = createSignMcpServer({ allowEnvKey: true });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
