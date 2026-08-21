export const runtime = "nodejs";

const LLMS_TXT = `# AgentSign

AgentSign is a signing primitive. Human always signs. Bearer keys authenticate the caller; they never skip the signer and never auto-sign. No sign tool. Humans Finish. Agents Attest.

## MCP tools

- send — POST /v1/envelopes. PDF bytes (base64), not a public pdf_url. Optional Bearer sign_live_ key. Without a key, send starts an OTP one-off; check sender email. sign_tmp_ cannot send or list. Signer objects may include kind (human|agent) and agent slug.
- status — GET /v1/envelopes/{id}. Requires a tmp or live key.
- download — GET /v1/envelopes/{id}.pdf. Requires a tmp or live key. Returns the sealed PDF after the human ceremony.
- attest — POST /v1/envelopes/{id}/attest. Current party is an agent this caller may use. Args: envelope_id, optional agent slug, optional api_key. sign_agent_ infers the slug.
- reject — POST /v1/envelopes/{id}/reject. Agent decline. Same args as attest.
- verify — POST /v1/verify. Unauthenticated. Base64 PDF bytes. Checks our seal.
- list_packets — GET /v1/packets. Requires a live key.
- send_packet — POST /v1/packets/{id}/send. Requires a live key. Signers in role order.

There is no sign, complete, or create_template tool. Branding, agents, and team are REST only — not MCP tools.

## REST

POST /v1/envelopes
GET /v1/envelopes
GET /v1/envelopes/{id}
GET /v1/envelopes/{id}.pdf
DELETE /v1/envelopes/{id}
POST /v1/envelopes/{id}/attest
POST /v1/envelopes/{id}/reject

POST /v1/verify

GET /v1/agents
POST /v1/agents
DELETE /v1/agents/{id}
POST /v1/agents/{id}/rotate
PUT /v1/agents/{id}/webhook

GET /v1/branding
PUT /v1/branding
DELETE /v1/branding/logo
GET /v1/packets
POST /v1/packets
GET /v1/packets/{id}
PATCH /v1/packets/{id}
DELETE /v1/packets/{id}
POST /v1/packets/{id}/send
GET /v1/team
POST /v1/team/invites
DELETE /v1/team/members/{id}
POST /team/accept

GET /s/{token}/logo — ceremony token only; not a public account URL.

Optional Bearer on POST /v1/envelopes. Branding, packets, agents, and team need a logged-in Pro session or sign_live_ key (self-host: SELF_HOST=1 is entitled). Tmp keys cannot call them. Attest/reject accept sign_agent_ or live/session naming agent. Verify needs no auth. Errors are JSON { error, code }.
`;

export function GET(): Response {
  return new Response(LLMS_TXT, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
