# AgentSign

A signing **primitive**, not a signing suite. Drop a file or `POST` it. A human Finishes. An agent can Attest. You get a PDF and an audit trail. Open source + cloud.

Product of MAR3. Public repo [yohanmarshall/AgentSign](https://github.com/yohanmarshall/AgentSign). Canonical host **https://agentsign.co**. Folder and npm name stay `sign`. Key prefixes stay `sign_tmp_` / `sign_live_` / `sign_agent_`.

**Free path does not require a login.** Optional login (Supabase Auth: magic link, email+password, Google, GitHub) is for people who want to keep their documents and mint live API keys. Machines use `sign_tmp_…` (job, dies with the file), `sign_live_…` (minted after login), or a Pro named-agent `sign_agent_…` to Attest. **Humans never need an account to Finish.** After they sign, we ask them to create one so they can keep docs they signed — that is the growth loop. Never signup-to-sign. Keys authenticate the caller; they never Finish a human party. No `sign` MCP tool.

**Legal:** same class as DocuSeal’s **default** product — SES designed for ESIGN + UETA (consent, intent, email-link attribution, PKCS#12 seal, completion certificate). Agent attestation is a cryptographic receipt, not an electronic signature. We do **not** claim court admissibility, SOC 2, HIPAA, or QES.

**Packaging:** two columns. **Free** (login optional): 7 days to sign, **7-day shredder** after keep window, live keys after login, quiet ~20 sends / 30 days, “Sent with AgentSign” on the appearance page. **Pro $19/mo** (Stripe Checkout): 1-year keep, cap lift, footer off, plus branding, saved templates, team invites (soft cap 10, not billed per person), and **10 named agents**. No seats, no per-document, no Enterprise page. Self-host is forever: set `SELF_HOST=1` to entitle Pro extras without a Stripe plan.

**Surface:** REST (`/v1/documents`, `/v1/verify`; Pro/self-host `/v1/branding`, `/v1/templates`, `/v1/team`, `/v1/agents`) + **OpenAPI** (`/openapi.json`) + **llms.txt** + MCP (stdio and HTTP): `send`, `status`, `download`, `attest`, `reject`, `verify`, `list_templates`, `send_template`. No `sign` tool. Humans Finish. Agents Attest. Ceremony logo is `GET /s/:token/logo` (signing token, not a public account URL).

**Platforms:** **Vercel** (Next.js App Router — pages **and** `/v1` Route Handlers, Fluid Compute **Node**, Cron) + **Supabase** (Postgres, Auth, Storage) + **Resend** (app mail) + **Stripe Checkout** (Pro). Pages: **shadcn/ui on Base UI** (Tailwind). Auth stays on Supabase (point custom SMTP at Resend). Self-host is `supabase start` + `next start`. No Hono. **Apache-2.0.**

## Docs

- [Product plan](docs/2026-08-19-product-plan.md) — positioning, auth lanes, retention, stack, decisions
- [Name](docs/name.md) — AgentSign, domains, key prefixes
- [OSS competitor research](docs/research/2026-08-20-competitor-research.md) — DocuSeal, Documenso, OpenSign, SendSign, LibreSign, Signbee; steal/avoid
- [v1 implementation plan](docs/superpowers/plans/2026-08-20-sign-v1.md) — walking skeleton
- [v1.1 design](docs/superpowers/specs/2026-08-20-sign-v1.1-design.md) — branding, templates, team
- [v1.1 implementation plan](docs/superpowers/plans/2026-08-20-sign-v1.1.md)
- [v1.2 design](docs/superpowers/specs/2026-08-21-agentsign-v1.2-design.md) — mixed parties, OAuth, verify
- [v1.2 implementation plan](docs/superpowers/plans/2026-08-21-agentsign-v1.2.md)

License: **Apache-2.0** (`LICENSE`).

## Local run

Copy `.env.example` to `.env` and fill what you need. Tests and local dogfood do **not** require a live Vercel or Supabase project. PGlite covers the suite; `STORAGE_DIR` is filesystem blobs for local dogfood (`pnpm dev`). Invite links in mail use `APP_URL` (default `http://localhost:3000`). For self-host entitlement, uncomment `SELF_HOST=1` in `.env` (see `.env.example`). Leave it unset on the public cloud.

Optional Postgres for a fuller local stack (compose file is yours if you add one):

```bash
# docker compose up -d   # optional local Postgres; set DATABASE_URL
```

```bash
pnpm install
pnpm test          # Vitest (PGlite) — no cloud required
pnpm dev           # Next.js on http://localhost:3000
```

With the dev server up:

```bash
./scripts/dogfood.sh
# or: BASE_URL=http://localhost:3000 ./scripts/dogfood.sh
```

That curls `GET /health` and prints the homepage one-off curl (multipart local `form.pdf` — no network PDF URL). Documents can be sent as markdown (rendered to a clean PDF server-side, `{{sig}}` tags place fields, source kept and retrievable via `GET /v1/documents/:id/pdf?kind=source`) or as an existing PDF. Examples:

```bash
curl -F title=Repair\ authorization \
     -F sender_email=shop@example.com \
     -F signers='[{"name":"Jane","email":"jane@example.com"}]' \
     --form-string markdown=$'# Repair authorization\n\nSign below to approve the repair.\n\n{{sig}}' \
     http://localhost:3000/v1/documents
```

```bash
curl -F title=Repair\ authorization \
     -F sender_email=shop@example.com \
     -F signers='[{"name":"Jane","email":"jane@example.com"}]' \
     -F file=@form.pdf \
     http://localhost:3000/v1/documents
```

Sender gets an OTP email (or log-only in dev without `RESEND_API_KEY`). After OTP, a `sign_tmp_…` key and signer link are issued. Signers finish at `/s/[token]` with no account.

MCP bin is `sign-mcp` (`pnpm sign-mcp`). HTTP MCP is `POST /mcp`.

**Shred note:** Free documents hard-delete PDF bytes when `shred_at` is due (7 days to sign if never completed; 7 days after completion on Free). Cron hits `GET /internal/shred` with `Authorization: Bearer $CRON_SECRET`. Void is `DELETE /v1/documents/:id` (immediate purge). There is no restore.
