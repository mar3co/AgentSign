export const runtime = "nodejs";

const LLMS_TXT = `# Sign

Sign is a signing primitive. Human always signs. Bearer keys authenticate the caller; they never skip the signer and never auto-sign.

## MCP tools

- send — POST /v1/envelopes. PDF bytes (base64), not a public pdf_url. Optional Bearer sign_live_ key. Without a key, send starts an OTP one-off; check sender email. sign_tmp_ cannot send or list.
- status — GET /v1/envelopes/{id}. Requires a tmp or live key.
- download — GET /v1/envelopes/{id}.pdf. Requires a tmp or live key. Returns the sealed PDF after the human ceremony.

There is no sign, complete, or create_template tool. Branding, packets, and team are REST only — not MCP tools.

## REST

POST /v1/envelopes
GET /v1/envelopes
GET /v1/envelopes/{id}
GET /v1/envelopes/{id}.pdf
DELETE /v1/envelopes/{id}

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

Optional Bearer on POST /v1/envelopes. Branding, packets, and team need a logged-in Pro session or sign_live_ key (self-host: SELF_HOST=1 is entitled). Tmp keys cannot call them. Errors are JSON { error, code }.
`;

export function GET(): Response {
  return new Response(LLMS_TXT, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
