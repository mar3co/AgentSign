# Sign (name TBD)

A signing **primitive**, not a signing suite. Drop a file or `POST` it. A human signs. You get a PDF and an audit trail. Open source + cloud.

This folder is its own product under MAR3. Same public cloud for everyone. Not a suite SKU, not an industry fork.

**Name is still open.** Working title in docs: Sign. Folder: `sign`.

**Free path does not require a login.** Optional login (Supabase Auth: magic link, email+password, Google, GitHub) is for people who want a cabinet and live API keys. Machines use `sign_tmp_…` (job, dies with the file) or `sign_live_…` (minted after login). **Signers never need an account to finish.** After they sign, we ask them to create one so they can keep docs they signed — that is the growth loop. Never signup-to-sign.

**Legal:** same class as DocuSeal’s **default** product — SES designed for ESIGN + UETA (consent, intent, email-link attribution, PKCS#12 seal, completion certificate). SOC 2 / HIPAA / QES are vendor badges, not what makes a signature admissible; we do not claim them. No “court admissible” guarantee.

**Packaging:** two columns. **Free** (login optional): 7 days to sign, 7 days to keep, live keys after login, quiet ~20 sends / 30 days. **Pro $19/mo** (Stripe Checkout): 1-year keep, cap lift, footer off. No seats, no per-document, no Enterprise page. Team later = invites on the same Pro cabinet. Self-host is forever.

**Platforms:** **Vercel** (Next.js App Router — pages **and** `/v1` Route Handlers, Fluid Compute **Node**, Cron) + **Supabase** (Postgres, Auth, Storage) + **Resend** (app mail) + **Stripe Checkout** (Pro). Pages: **shadcn/ui on Base UI** (Tailwind). Auth (magic link, password, Google, GitHub) stays on Supabase (point custom SMTP at Resend). Self-host is `supabase start` + `next start`. No Hono. Apache-2.0.

## Docs

- [Product plan](docs/2026-08-19-product-plan.md) — positioning, auth lanes, retention, stack, decisions
- [Name notes](docs/name.md) — constraints, not a final pick
- [OSS competitor research](docs/research/2026-08-20-competitor-research.md) — DocuSeal, Documenso, OpenSign, SendSign, LibreSign, Signbee; steal/avoid
- [v1 implementation plan](docs/superpowers/plans/2026-08-20-sign-v1.md) — walking skeleton, task-by-task

No code yet. **Apache-2.0.**
