# AgentSign

A signing **primitive**, not a signing suite. Drop a file or `POST` it. A human Finishes. An agent can Attest. You get a PDF and an audit trail. Open source + cloud.

Product of MAR3. Repo [mar3co/AgentSign](https://github.com/mar3co/AgentSign). Canonical host **https://agentsign.co**. Folder and npm name stay `sign`. Key prefixes stay `sign_tmp_` / `sign_live_` / `sign_agent_` / `sign_oauth_`.

**Free path does not require a login.** Optional login (Supabase Auth: passkey, magic link, email+password, Google, GitHub) is for people who want to keep their documents and mint live API keys. Machines use `sign_tmp_…` (job, dies with the file), `sign_live_…` (minted after login), `sign_oauth_…` (granted to a connected agent), or a Pro named-agent `sign_agent_…` to Attest. **Humans never need an account to Finish.** After they sign, we ask them to create one so they can keep docs they signed — that is the growth loop. Never signup-to-sign. Keys authenticate the caller; they never Finish a human party. No `sign` MCP tool.

**Legal:** same class as DocuSeal’s **default** product — SES designed for ESIGN + UETA (consent, intent, email-link attribution, PKCS#12 seal, completion certificate). Agent attestation is a cryptographic receipt, not an electronic signature. We do **not** claim court admissibility, SOC 2, HIPAA, or QES.

**Packaging:** two columns. **Free** (login optional): 7 days to sign, **7-day shredder** after keep window, live keys after login, quiet ~20 sends / 30 days, “Sent with AgentSign” on the appearance page. **Pro $19/mo** (Stripe Checkout): 1-year keep, cap lift, footer off, plus branding, saved templates (cap 50), team invites (soft cap 10, not billed per person), and **10 named agents**. No seats, no per-document, no Enterprise page. Self-host is forever: set `SELF_HOST=1` to entitle Pro extras without a Stripe plan.

**Surface:** REST, grouped by who can call it: open (`/v1/documents`, `/v1/verify`, `/v1/detect-fields`), account (`/v1/keys` mints live keys, plus `/v1/workspace`, `/v1/billing`, `/v1/activity`, `/v1/stats`, `/v1/sending`), and Pro or self-host (`/v1/branding`, `/v1/templates`, `/v1/team`, `/v1/agents`). **`/openapi.json` is the full list with request and response shapes**; **llms.txt** is the same surface for agents. MCP (stdio and HTTP) exposes `send`, `status`, `download`, `attest`, `reject`, `verify`, `list_templates`, `send_template`. No `sign` tool. Humans Finish. Agents Attest. Ceremony logo is `GET /s/:token/logo` (signing token, not a public account URL).

Agents can also connect over **OAuth** instead of a pasted key: dynamic client registration at `/oauth/register`, discovery under `/.well-known/`, and the grant mints a `sign_oauth_…` token. Those sends are held for the account owner's emailed confirmation unless they turn that off.

**Platforms:** **Vercel** (Next.js App Router — pages **and** `/v1` Route Handlers, Fluid Compute **Node**, Cron) + **Supabase** (Postgres, Auth, Storage) + **Resend** (app mail) + **Stripe Checkout** (Pro). Pages: **shadcn/ui on Base UI** (Tailwind). Auth stays on Supabase (point custom SMTP at Resend). Self-host is `supabase start` + `next start`. No Hono. **Apache-2.0.**

Document work, since it shapes the deploy: PDFs are read with `pdfjs-dist` (+ `@napi-rs/canvas`) and written with `pdf-lib`; markdown renders through `marked`; `.docx` converts through `mammoth` + headless Chromium (`puppeteer-core`, `@sparticuz/chromium`); the seal is `@signpdf` + `node-forge`; `/v1/detect-fields` is a Vercel **AI SDK** call through AI Gateway (`AI_GATEWAY_API_KEY`, or OIDC on Vercel). Those payloads are why `.npmrc` pins a hoisted `node_modules` and `next.config.ts` traces files explicitly. Agent-party behavior and AI detection sit behind Vercel feature flags (`agent_parties`, `agent_only_attest`, `ai_field_detect`).

## Docs

- [Product plan](docs/2026-08-19-product-plan.md): positioning, auth lanes, retention, stack, decisions
- [Name](docs/name.md): AgentSign, domains, key prefixes
- [OSS competitor research](docs/research/2026-08-20-competitor-research.md): DocuSeal, Documenso, OpenSign, SendSign, LibreSign, Signbee; steal/avoid
- [Design specs and plans](docs/superpowers/): one dated design and plan per feature (v1 through markdown send), written before the code and reviewed in the PR that ships it
- [Wiki](https://github.com/mar3co/AgentSign/wiki): product orientation for humans who are not in the code yet

License: **Apache-2.0** (`LICENSE`).

## Local run

Copy `.env.example` to `.env.local` and fill what you need. Tests and local dogfood do **not** require a live Vercel or Supabase project.

**No cloud at all: set `DEV_OFFLINE=1`.** Any email plus any non-empty password logs in, the database is embedded PGlite in `.dev/`, blobs go to `STORAGE_DIR`, and mail (OTP codes, signing links) prints to the dev console as `[mail:body]` instead of sending. Magic links, OAuth, and passkeys still need real Supabase. The flag is ignored on Vercel and in production.

PGlite also covers the test suite. Invite links in mail use `APP_URL` (default `http://localhost:3000`). For self-host entitlement, set `SELF_HOST=1`; leave it unset on the public cloud. Note that Next reads `.env.local` ahead of `.env`, so an old `.env.local` will quietly win over edits you make to `.env`.

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

That curls `GET /health` and prints the homepage one-off curl (multipart local `form.pdf` — no network PDF URL). Documents can be sent as markdown (rendered to a clean PDF server-side, `{{sig}}` tags place fields, source kept and retrievable via `GET /v1/documents/:id.pdf?kind=source`), as an existing PDF, or as a Word file (.docx, converted to PDF server-side). Examples:

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

**MCP.** HTTP is the supported path: `POST /mcp` (streamable HTTP), one endpoint, eight tools (`send`, `status`, `download`, `attest`, `reject`, `verify`, `list_templates`, `send_template`) and no `sign` tool. Hosts that speak OAuth need only the URL: discovery lives at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, registration at `POST /oauth/register`, OAuth 2.1 with PKCE (S256); an unauthenticated `POST /mcp` answers 401 with the resource metadata. Hosts that take a secret can pass `Authorization: Bearer sign_live_…` instead. Setup snippets, the agent party rules, per-agent webhooks, and the error codes are at `/docs#mcp` and `/docs#agents`. The `sign-mcp` bin (`pnpm sign-mcp`) is stdio for local work only: it boots the TypeScript source through `tsx`, so it runs from a checkout of this repo and nowhere else.

**Shred note:** Free documents hard-delete PDF bytes when `shred_at` is due (7 days to sign if never completed; 7 days after completion on Free). Cron hits `GET /internal/shred` daily with `Authorization: Bearer $CRON_SECRET`; the same sweep also sends signing reminders. Void is `DELETE /v1/documents/:id` (immediate purge). There is no restore.
