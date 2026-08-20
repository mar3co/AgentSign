export const runtime = "nodejs";

const LLMS_TXT = `# Sign

Sign is a signing primitive. Human always signs. Bearer keys authenticate the caller; they never skip the signer and never auto-sign.

## MCP tools

- send — POST /v1/envelopes. PDF bytes (base64), not a public pdf_url. Optional Bearer tmp or live key. Without a key, send starts an OTP one-off; check sender email.
- status — GET /v1/envelopes/{id}. Requires a tmp or live key.
- download — GET /v1/envelopes/{id}.pdf. Requires a tmp or live key. Returns the sealed PDF after the human ceremony.

There is no sign, complete, or create_template tool.

## REST

POST /v1/envelopes
GET /v1/envelopes
GET /v1/envelopes/{id}
GET /v1/envelopes/{id}.pdf
DELETE /v1/envelopes/{id}

Optional Bearer on POST. Errors are JSON { error, code }.
`;

export function GET(): Response {
  return new Response(LLMS_TXT, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
