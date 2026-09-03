import { appOrigin } from "@/src/env";

export const runtime = "nodejs";

function llmsTxt(origin: string): string {
  return `# OpenSeal

OpenSeal is a signing primitive. Human always signs. Bearer keys authenticate the caller; they never skip the signer and never auto-sign. No sign tool. Humans Finish. Agents Attest.

## MCP

Endpoint: ${origin}/mcp (streamable HTTP, POST).
Claude Code: claude mcp add --transport http openseal ${origin}/mcp
Cursor (mcp.json): {"mcpServers":{"openseal":{"url":"${origin}/mcp"}}}
Claude Desktop / claude.ai: Settings > Connectors > Add custom connector, URL ${origin}/mcp.
Auth: OAuth 2.1 + PKCE (S256), or Authorization: Bearer sign_live_ / sign_agent_. An unauthenticated POST /mcp returns 401 with WWW-Authenticate resource_metadata.
Discovery: GET /.well-known/oauth-protected-resource, GET /.well-known/oauth-authorization-server. Client registration: CIMD https client_id, else dynamic registration at POST /oauth/register. Consent at GET /oauth/authorize, tokens at POST /oauth/token. A grant carries the agents it may attest as.
stdio MCP does not do OAuth: env or pasted sign_agent_ / SIGN_API_KEY only.

## MCP tools

- send — POST /v1/documents. Prefer markdown: plain text, no file handling; {{sig}} tags place fields and it is rendered to a clean PDF server-side (Latin-1 text only; tags in code blocks stay literal). Or PDF bytes (base64), not a public pdf_url. Exactly one of markdown or pdf. DOCX uploads are REST-only (multipart, converted to PDF). Optional Bearer sign_live_ key. Without a key, send starts an OTP one-off; check sender email. sign_tmp_ cannot send or list. Signer objects may include kind (human|agent) and agent slug.
- status — GET /v1/documents/{id}. Requires a tmp or live key.
- download — GET /v1/documents/{id}.pdf. Requires a tmp or live key. Returns the sealed PDF after the human ceremony; over MCP it arrives as a base64 embedded resource (application/pdf). PDFs over 3 MB are not returned by the tool, fetch them from the REST route instead. 409 if not completed.
- attest — POST /v1/documents/{id}/attest. Current party is an agent this caller may use. Args: document_id, optional agent slug, optional api_key. sign_agent_ infers the slug.
- reject — POST /v1/documents/{id}/reject. Agent decline. Same args as attest.
- verify — POST /v1/verify. Unauthenticated on the REST endpoint; every MCP call still needs a bearer. Base64 PDF bytes. Checks our seal.
- list_templates — GET /v1/templates. Requires a live key.
- send_template — POST /v1/templates/{id}/send. Requires a live key. Signers in role order.

There is no sign, complete, or create_template tool. Branding, agents, and team are REST only — not MCP tools.

## Agents

An agent party is a party with kind=agent and a slug registered on the team (max 10). It has no /s/ token and no ceremony; it attests or rejects over the API. An agent party carries the account owner's email address; a different email is rejected with invalid_request. Complete needs every party done and at least one human signed_at, unless the agent_only_attest flag is on. Agent parties need Pro (self-host is entitled) and the agent_parties flag.

sign_agent_ keys attest and reject as their own agent only. A sign_live_ key, a session, or an OAuth grant attests by naming an agent slug the team owns (body { agent }); a grant only for the agents it was allowed. Sending needs a live key, a session, or an OAuth grant.

Confirm sends: a send from an OAuth grant is held at status pending_sender until the account owner enters an emailed 6-digit code. Default on; the owner turns it off at /settings/security. sign_live_ keys always send at once.

Agent webhooks: PUT /v1/agents/{id}/webhook sets an https URL and returns the HMAC secret once. Events: party.ready, document.completed, document.declined, document.expired. Body { event, id, agent, status }. Headers X-Sign-Timestamp and X-Sign-Signature: sha256=HMAC-SHA256(secret, "{timestamp}.{rawBody}"). Document-level webhooks (webhook_url on send) also emit document.opened and signer.completed.

Agent error codes ({ error, code }): human_required (400, every party attested and none signed; the document needs a human signer, so add one when sending), invalid_state (409, not awaiting attestation), cannot_attest (403, caller may not attest as that agent or it is not that agent's turn), unknown_agent (400, no such slug), agent_limit (400, 10 per team), pro_required (403), flag_off (403, agent parties disabled), invalid_request (400, an agent party's email didn't match the agent owner's account), slug_taken (409, that agent slug is already registered on this team).

## On-page fields and embed

Optional on POST /v1/documents: fields JSON (page 1-based, x/y/w/h percent top-left), values prefill, order=parallel, send_email=false, embed_origin, completed_redirect_url. {{sig}} tags work in markdown and in PDF Free one-offs. Markdown sends keep their source: GET /v1/documents/{id}.pdf?kind=source returns it (any time before shred). Embed: iframe /s/:token and listen for postMessage { source: "openseal", event }. No sign tool.

## REST

POST /v1/documents
GET /v1/documents
GET /v1/documents/{id}
GET /v1/documents/{id}.pdf
DELETE /v1/documents/{id}
POST /v1/documents/{id}/attest
POST /v1/documents/{id}/reject

POST /v1/verify

GET /v1/agents
POST /v1/agents
DELETE /v1/agents/{id}
POST /v1/agents/{id}/rotate
PUT /v1/agents/{id}/webhook

GET /v1/branding
PUT /v1/branding
DELETE /v1/branding/logo
GET /v1/templates
POST /v1/templates
GET /v1/templates/{id}
PATCH /v1/templates/{id}
DELETE /v1/templates/{id}
POST /v1/templates/{id}/send
GET /v1/team
POST /v1/team/invites
DELETE /v1/team/members/{id}
POST /v1/team/leave
POST /team/accept
GET /v1/workspace
PATCH /v1/workspace
GET /v1/workspace/export
POST /v1/workspace/dissolve
GET /v1/billing
POST /v1/billing/portal
GET /v1/sending
PATCH /v1/sending
POST /v1/keys
GET /v1/activity
GET /v1/stats
POST /v1/detect-fields
GET /openapi.json

POST /mcp
GET /.well-known/oauth-protected-resource
GET /.well-known/oauth-authorization-server
GET /oauth/authorize
POST /oauth/token
POST /oauth/register

GET /s/{token}/logo — ceremony token only; not a public account URL.
GET /s/{token}/preview — original PDF for the ceremony overlay.

Optional Bearer on POST /v1/documents. Branding, templates, agents, and team need a logged-in Pro session or sign_live_ key (self-host: SELF_HOST=1 is entitled). Tmp keys cannot call them. Attest/reject accept sign_agent_ or live/session naming agent. Verify needs no auth. Errors are JSON { error, code }.

Human docs: ${origin}/docs (MCP: ${origin}/docs#mcp, agents: ${origin}/docs#agents).
`;
}

export function GET(): Response {
  return new Response(llmsTxt(appOrigin()), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
