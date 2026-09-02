import { createRequire } from "node:module";
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
import { attestDocument, rejectDocument } from "../routes/attest.js";
import {
  createDocument,
  getDocument,
  getDocumentPdf,
} from "../routes/documents.js";
import { listTemplates, sendTemplate } from "../routes/templates.js";
import { verifyDocument } from "../routes/verify.js";

const signerSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  kind: z.enum(["human", "agent"]).optional(),
  agent: z.string().optional(),
});

const templateSignerSchema = z.object({
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

/** The caller's IP headers, so verify's rate limit keys on them, not on one shared bucket. */
function clientIpHeaders(extra: Extra): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"]) {
    const value = headerValue(extra.requestInfo?.headers, name);
    if (value) out[name] = value;
  }
  return out;
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

const require = createRequire(import.meta.url);
const packageVersion = (require("../../package.json") as { version: string }).version;

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
    { name: "agentsign", version: packageVersion },
    {
      instructions:
        "AgentSign is a signing primitive. Human always signs. Keys authenticate the caller and never sign. No sign tool. Humans Finish. Agents Attest. Tools: send, status, download, attest, reject, verify, list_templates, send_template. Optional send fields (JSON); message, send/send_template values, order, send_email, completed_redirect_url, embed_origin. PDF {{sig}} tags work on Free one-offs.",
    },
  );

  server.registerTool(
    "send",
    {
      title: "Send document",
      description:
        "Create and send a signing document (POST /v1/documents). Prefer markdown — plain text, no file handling; {{sig}} tags place fields and it is rendered to a clean PDF server-side. Or pass PDF bytes as base64 (not a public pdf_url) when you already have a PDF. Exactly one of markdown or pdf. Optional Bearer sign_live_ key. Without a key, starts a sender OTP one-off — tell the operator to check sender email. OAuth callers usually get pending_sender too: the account holds agent sends for an emailed confirmation code unless turned off in Settings. sign_live_ keys always send immediately. sign_tmp_ cannot send or list. Signer objects may include kind (human|agent) and agent slug. Optional fields JSON, message, values, order, send_email, completed_redirect_url, embed_origin. No sign tool. Humans Finish. Agents Attest.",
      inputSchema: {
        title: z.string().min(1),
        sender_email: z.string().min(1),
        signers: z.array(signerSchema).min(1),
        markdown: z
          .string()
          .optional()
          .describe(
            "Document content as markdown. Rendered to PDF server-side; {{sig}} tags place signature fields (tags inside code blocks stay literal). Latin-1 text only: characters outside WinAnsi (emoji, CJK) are dropped. Preferred over pdf.",
          ),
        pdf: z
          .string()
          .optional()
          .describe("Base64-encoded PDF bytes. Not a URL. Use when you already have a PDF."),
        api_key: z.string().optional(),
        fields: z.string().optional().describe("JSON array of on-page fields."),
        message: z.string().max(1000).optional().describe("Message shown to signers in the invite email."),
        values: z.string().optional().describe("JSON object of prefilled field values."),
        order: z.enum(["sequential", "parallel"]).optional(),
        send_email: z.boolean().optional(),
        completed_redirect_url: z.string().optional(),
        embed_origin: z.string().optional(),
      },
    },
    async (args, extra) => {
      if ((args.markdown == null) === (args.pdf == null)) {
        return toolText(
          JSON.stringify({
            error: "Provide exactly one of markdown or pdf",
            code: "invalid_request",
          }),
          true,
        );
      }
      const form = new FormData();
      form.set("title", args.title);
      form.set("sender_email", args.sender_email);
      form.set("signers", JSON.stringify(args.signers));
      if (args.markdown != null) {
        form.set("markdown", args.markdown);
      } else {
        let bytes: Uint8Array;
        try {
          bytes = Uint8Array.from(Buffer.from(args.pdf!, "base64"));
        } catch {
          return toolText(
            JSON.stringify({ error: "File must be a PDF", code: "invalid_pdf" }),
            true,
          );
        }
        form.set("file", new Blob([Buffer.from(bytes)], { type: "application/pdf" }), "document.pdf");
      }
      if (args.fields != null) form.set("fields", args.fields);
      if (args.message != null) form.set("message", args.message);
      if (args.values != null) form.set("values", args.values);
      if (args.order != null) form.set("order", args.order);
      if (args.send_email != null) form.set("send_email", args.send_email ? "true" : "false");
      if (args.completed_redirect_url != null) {
        form.set("completed_redirect_url", args.completed_redirect_url);
      }
      if (args.embed_origin != null) form.set("embed_origin", args.embed_origin);
      const headers = new Headers();
      const key = resolveKey(args, extra, allowEnvKey);
      if (key) headers.set("authorization", `Bearer ${key}`);
      const res = await createDocument(
        new Request("http://sign.local/v1/documents", {
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
          : "Document sent. A human must sign. Keys never sign.";
      return toolText(JSON.stringify({ ...body, message }));
    },
  );

  server.registerTool(
    "status",
    {
      title: "Document status",
      description:
        "GET /v1/documents/{id}. Requires a tmp or live Bearer key. Returns status, signers, and audit. Human always signs — this tool never completes a signature.",
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
      const res = await getDocument(
        new Request(`http://sign.local/v1/documents/${args.id}`, {
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
        "GET /v1/documents/{id}.pdf. Requires a tmp or live Bearer key. Returns the sealed PDF after the human ceremony as a base64-encoded embedded resource (application/pdf). 409 if not completed.",
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
      const res = await getDocumentPdf(
        new Request(`http://sign.local/v1/documents/${args.id}.pdf`, {
          headers: { authorization: `Bearer ${key}` },
        }),
        args.id,
      );
      if (!res.ok) {
        return toolText(await jsonOrText(res), true);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const fileName = `${args.id}.pdf`;
      return {
        content: [
          { type: "text" as const, text: `${fileName} (${bytes.byteLength} bytes)` },
          {
            type: "resource" as const,
            resource: {
              uri: `agentsign://documents/${fileName}`,
              mimeType: "application/pdf",
              blob: Buffer.from(bytes).toString("base64"),
            },
          },
        ],
        isError: false,
      };
    },
  );

  server.registerTool(
    "attest",
    {
      title: "Attest as an agent",
      description:
        "POST /v1/documents/{id}/attest. Current party must be an agent this caller may use. Named-agent sign_agent_ key infers the slug; live/session must pass agent. No sign tool. Humans Finish. Agents Attest.",
      inputSchema: {
        document_id: z.string(),
        agent: z.string().optional(),
        api_key: z.string().optional(),
      },
    },
    async (args, extra) => {
      const headers = new Headers({ "content-type": "application/json" });
      const key = resolveKey(args, extra, allowEnvKey);
      if (key) headers.set("authorization", `Bearer ${key}`);
      const res = await attestDocument(
        new Request(`http://sign.local/v1/documents/${args.document_id}/attest`, {
          method: "POST",
          headers,
          body: JSON.stringify(args.agent ? { agent: args.agent } : {}),
        }),
        args.document_id,
      );
      return toolText(await jsonOrText(res), !res.ok);
    },
  );

  server.registerTool(
    "reject",
    {
      title: "Reject as an agent",
      description:
        "POST /v1/documents/{id}/reject. Agent decline for the current party. Same auth as attest. No sign tool. Humans Finish. Agents Attest.",
      inputSchema: {
        document_id: z.string(),
        agent: z.string().optional(),
        api_key: z.string().optional(),
      },
    },
    async (args, extra) => {
      const headers = new Headers({ "content-type": "application/json" });
      const key = resolveKey(args, extra, allowEnvKey);
      if (key) headers.set("authorization", `Bearer ${key}`);
      const res = await rejectDocument(
        new Request(`http://sign.local/v1/documents/${args.document_id}/reject`, {
          method: "POST",
          headers,
          body: JSON.stringify(args.agent ? { agent: args.agent } : {}),
        }),
        args.document_id,
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
    async (args, extra) => {
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(Buffer.from(args.pdf, "base64"));
      } catch {
        return toolText(
          JSON.stringify({ error: "A PDF is required", code: "invalid_request" }),
          true,
        );
      }
      const res = await verifyDocument(
        new Request("http://sign.local/v1/verify", {
          method: "POST",
          headers: { "content-type": "application/pdf", ...clientIpHeaders(extra) },
          body: Buffer.from(bytes),
        }),
      );
      return toolText(await jsonOrText(res), !res.ok);
    },
  );

  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description:
        "GET /v1/templates. Requires a session or sign_live_ Bearer. sign_tmp_ cannot list. Returns saved templates for the team.",
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
      const res = await listTemplates(
        new Request("http://sign.local/v1/templates", {
          headers: { authorization: `Bearer ${key}` },
        }),
      );
      return toolText(await jsonOrText(res), !res.ok);
    },
  );

  server.registerTool(
    "send_template",
    {
      title: "Send a template",
      description:
        "POST /v1/templates/{id}/send. Requires a session or sign_live_ Bearer. signers.length must equal template role count; order is signing_order. Each signer is { name, email } only — no kind/agent. Mixed parties use send. Copies template fields. Optional values, order, send_email, completed_redirect_url, embed_origin. Human always signs.",
      inputSchema: {
        id: z.string().min(1),
        signers: z.array(templateSignerSchema).min(1),
        api_key: z.string().optional(),
        values: z.string().optional().describe("JSON object of prefilled field values."),
        order: z.enum(["sequential", "parallel"]).optional(),
        send_email: z.boolean().optional(),
        completed_redirect_url: z.string().optional(),
        embed_origin: z.string().optional(),
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
      const body: Record<string, unknown> = { signers: args.signers };
      if (args.values != null) {
        try {
          body.values = JSON.parse(args.values);
        } catch {
          body.values = args.values;
        }
      }
      if (args.order != null) body.order = args.order;
      if (args.send_email != null) body.send_email = args.send_email;
      if (args.completed_redirect_url != null) {
        body.completed_redirect_url = args.completed_redirect_url;
      }
      if (args.embed_origin != null) body.embed_origin = args.embed_origin;
      const res = await sendTemplate(
        new Request(`http://sign.local/v1/templates/${args.id}/send`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
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
