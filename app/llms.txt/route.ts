export const runtime = "nodejs";

const LLMS_TXT = `# AgentSign

AgentSign is a signing primitive. Human always signs. Bearer keys authenticate the caller; they never skip the signer and never auto-sign. No sign tool. Humans Finish. Agents Attest.

## MCP tools

- send — POST /v1/documents. PDF bytes (base64), not a public pdf_url. Optional Bearer sign_live_ key. Without a key, send starts an OTP one-off; check sender email. sign_tmp_ cannot send or list. Signer objects may include kind (human|agent) and agent slug.
- status — GET /v1/documents/{id}. Requires a tmp or live key.
- download — GET /v1/documents/{id}.pdf. Requires a tmp or live key. Returns the sealed PDF after the human ceremony.
- attest — POST /v1/documents/{id}/attest. Current party is an agent this caller may use. Args: document_id, optional agent slug, optional api_key. sign_agent_ infers the slug.
- reject — POST /v1/documents/{id}/reject. Agent decline. Same args as attest.
- verify — POST /v1/verify. Unauthenticated. Base64 PDF bytes. Checks our seal.
- list_templates — GET /v1/templates. Requires a live key.
- send_template — POST /v1/templates/{id}/send. Requires a live key. Signers in role order.

There is no sign, complete, or create_template tool. Branding, agents, and team are REST only — not MCP tools.

## On-page fields and embed

Optional on POST /v1/documents: fields JSON (page 1-based, x/y/w/h percent top-left), values prefill, order=parallel, send_email=false, embed_origin, completed_redirect_url. PDF {{sig}} tags work on Free one-offs. Embed: iframe /s/:token and listen for postMessage { source: "agentsign", event }. No sign tool.

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

GET /s/{token}/logo — ceremony token only; not a public account URL.
GET /s/{token}/preview — original PDF for the ceremony overlay.

Optional Bearer on POST /v1/documents. Branding, templates, agents, and team need a logged-in Pro session or sign_live_ key (self-host: SELF_HOST=1 is entitled). Tmp keys cannot call them. Attest/reject accept sign_agent_ or live/session naming agent. Verify needs no auth. Errors are JSON { error, code }.
`;

export function GET(): Response {
  return new Response(LLMS_TXT, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
