# Sign (name TBD)

A signing **primitive**, not a signing suite. Drop a file or `POST` it. A human signs. You get a PDF and an audit trail. Open source + cloud.

This folder is **its own product** under MAR3. Same public cloud for everyone. Not a suite SKU, not an industry fork.

**Name is still open.** Working title in docs: Sign. Folder: `sign`.

**Free path does not require a login.** Optional login (Supabase Auth: magic link, email+password, Google, GitHub) is for people who want a cabinet and live API keys. Machines use `sign_tmp_…` (job, dies with the file) or `sign_live_…` (minted after login). **Signers never need an account to finish.** After they sign, we ask them to create one so they can keep docs they signed — that is the growth loop. Never signup-to-sign.

**Legal:** same class as DocuSeal’s **default** product — SES designed for ESIGN + UETA (consent, intent, email-link attribution, PKCS#12 seal, completion certificate). We do **not** claim court admissibility, SOC 2, HIPAA, or QES.

**Packaging:** two columns. **Free** (login optional): 7 days to sign, **7-day shredder** after keep window, live keys after login, quiet ~20 sends / 30 days. **Pro $19/mo** (Stripe Checkout): 1-year keep, cap lift, footer off. No seats, no per-document, no Enterprise page. Team later = invites on the same Pro cabinet. Self-host is forever.

**Surface:** REST (`/v1/envelopes`) + **OpenAPI** (`/openapi.json`) + **llms.txt** + three **MCP** tools (`send`, `status`, `download` — stdio and HTTP). No `sign` tool; a human always signs.

**Platforms:** **Vercel** (Next.js App Router — pages **and** `/v1` Route Handlers, Fluid Compute **Node**, Cron) + **Supabase** (Postgres, Auth, Storage) + **Resend** (app mail) + **Stripe Checkout** (Pro). Pages: **shadcn/ui on Base UI** (Tailwind). Auth stays on Supabase (point custom SMTP at Resend). Self-host is `supabase start` + `next start`. No Hono. **Apache-2.0.**

## Docs

- [Product plan](docs/2026-08-19-product-plan.md) — positioning, auth lanes, retention, stack, decisions
- [Name notes](docs/name.md) — constraints, not a final pick
- [OSS competitor research](docs/research/2026-08-20-competitor-research.md) — DocuSeal, Documenso, OpenSign, SendSign, LibreSign, Signbee; steal/avoid
- [v1 implementation plan](docs/superpowers/plans/2026-08-20-sign-v1.md) — walking skeleton, task-by-task

License: **Apache-2.0** (`LICENSE`).

## Local run

Copy `.env.example` to `.env` and fill what you need. A live Vercel or Supabase project is **not** required to develop or run tests — PGlite covers the suite; `STORAGE_DIR` is filesystem blobs for local dogfood (`pnpm dev`). Invite links in mail use `APP_URL` (default `http://localhost:3000`).

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

That curls `GET /health` and prints the homepage one-off curl (multipart local `form.pdf` — no network PDF URL). Example:

```bash
curl -F title=Repair\ authorization \
     -F sender_email=shop@example.com \
     -F signers='[{"name":"Jane","email":"jane@example.com"}]' \
     -F file=@form.pdf \
     http://localhost:3000/v1/envelopes
```

Sender gets an OTP email (or log-only in dev without `RESEND_API_KEY`). After OTP, a `sign_tmp_…` key and signer link are issued. Signers finish at `/s/[token]` with no account.

**Shred note:** Free envelopes hard-delete PDF bytes when `shred_at` is due (7 days to sign if never completed; 7 days after completion on Free). Cron hits `GET /internal/shred` with `Authorization: Bearer $CRON_SECRET`. Void is `DELETE /v1/envelopes/:id` (immediate purge). There is no restore.
