# Sign — Product Plan

**Name:** OpenSeal (one word). Renamed from AgentSign on 2026-09-03; see [name.md](./name.md).  
**Date:** 2026-08-19  
**Updated:** 2026-08-21  
**Status:** Agreed direction. v1 + v1.1 implemented locally. v1.2 agent parties spec locked.  
**Repo:** [mar3co/openseal](https://github.com/mar3co/openseal)  
**Host:** openseal.me (Cloudflare). agentsign.co and agentsign.net → 301, permanently.  
**Not:** a suite SKU, an industry fork, or a private cloud for one company. This is its own product.

---

## 1. Thesis

DocuSeal and DocuSign are **document platforms**: templates, folders, tenants, seats, branding, then they meter the API — including on a server you already pay for.

We ship a **signing primitive**. Three verbs: send, sign, fetch.

> Turn a file into a signed, attributable PDF with an audit trail. Nothing else in v1.

The free product is a fax machine with a shredder on a timer: **no login required to send or to sign**. People who want a cabinet log in (still free) — including signers, **after** they finish. Machines use keys. A human always signs.

**Pro ($19/mo) is a filing cabinet for a year.** That is the only paid SKU. Not seats. Not per-document.

---

## 2. Why this wins (and what it is not)

### What people hate about DocuSeal

- API / embed locked behind a seat **and** `$0.20/doc` even when self-hosted
- “Open source” that does not include the integration surface
- Account → workspace → template before you can send one PDF
- Product gravity toward tenants, SSO, bulk, payments, field builders

### Adjacent products (do not clone)

| Product | Close to us | Why we are not them |
|---|---|---|
| **Signbee** | No account, one POST, MCP | Markdown-first, two-party, not really OSS, 5 docs/month; API key skips the human sender |
| **SendSign** | Agent-era, TypeScript | 16 MCP tools; suite-shaped; AGPL/README mismatch |
| **Documenso** | OSS + cloud | AGPL, template/dashboard product; SaaS fork needs their Enterprise license |
| **OpenSign** | OSS PDF | AGPL, Parse/Mongo suite, occupies the OpenSign name |
| **Dropbox Sign / DocuSign** | Known, trusted | Seats, OAuth, envelope ceremony |

Our opening is **honest OSS (API included on self-host) + PDF-first + 7-day free retention + login optional + no suite.**

Evidence: [OSS competitor research](./research/2026-08-20-competitor-research.md).

### What we refuse to become

A signing suite. Login is identity, not a gate. If a feature needs a settings page in v1, it is out — except “log in / mint a key / see my envelopes.”

---

## 3. Who it is for

One public product. One price. No private tenant.

- A person with a PDF (homepage drop, no account)
- A developer with `curl`
- An agent that can `send` / `status` / `download`

Examples of files, not verticals we sell: a repair authorization, an NDA, a lease. We do not fork the product per industry. We do not draft the customer’s legal language. We do not market “good enough for a California statutory POA.”

---

## 4. Surfaces (one engine)

Homepage: **PDF drop is the hero; `curl` is on the same first screen.** “Log in” is a small link, not the gate. Pages are **Next.js App Router + shadcn/ui on Base UI** (not Radix, not raw HTML). Still three surfaces — drop, sign, cabinet — not a dashboard product.

### 4.1 Free, no login (the fax)

1. Upload a PDF (bytes, not a URL).
2. Enter signer name + email (and sender email).
3. Sender proves they own the sender address (OTP). Stops spam.
4. We issue a **temporary key** (`sign_tmp_…`) for that job. Shown once. Dies with the shred date.
5. Signer has **7 days** to open the link, consent, and sign. **No account required to finish.**
6. Both inboxes get the signed PDF + completion certificate.
7. After completion we keep the file **7 more days**, then hard delete. If nobody signs, we shred when the link dies. The tmp key dies with the file.
8. **Then we ask.** Done screen + completion email: “Download this. We delete it on [date]. Keep it in a cabinet — free account.” Same login as senders (magic link, password, Google, GitHub). Finish is never behind that CTA.

No password to send. No workspace. Envelope UUID alone is not a credential — the tmp key is.

### 4.2 Logged in (still free — this week’s cabinet)

**Supabase Auth.** That is the person. **Login is not a plan.** Same clocks as the fax. v1 login page: magic link, email + password, **Google** and **GitHub** OAuth. No SAML / SSO.

- See *their* envelopes: jobs they **sent** (`sender_email` / `user_id`) and jobs they **signed** (`signers.email` matches the proven Auth email).
- Mint **live keys** (`sign_live_…`), optional expiry, revocable. Same free volume cap.
- Still **7 days** to keep after completion unless Pro. The list is this week’s jobs, not an archive.

**Pro** is Stripe Checkout on top of this account: 1-year keep on docs they sent **and** docs they signed, cap lift, footer off. See §7.

No org wizard, no “create your first template.” Login does not skip a human signer. Signup-to-sign is forbidden; signup-after-sign is the funnel.

### 4.3 Agent

v1 is REST **and** MCP on the same engine. An agent with a live key can `curl` or call three MCP tools: `send`, `status`, `download`. They wrap §6. No `sign` tool. Agent prepares and sends. Agent never holds signing authority.

v1 also ships `/openapi.json` + `/llms.txt`. Bearer only (`sign_tmp_` or `sign_live_`). Never `?apiKey=`. PDF **bytes**, not a URL. **stdio MCP in v1**; HTTP MCP after v1.

---

## 5. Auth (three lanes)

| Lane | Credential | Storage | Used for |
|---|---|---|---|
| Free sender | Email OTP, then `sign_tmp_…` | OTP hashed; tmp key hashed, `expires_at` = envelope `shred_at`, scoped to the envelope | Prove sender email; then GET/DELETE/PDF/`curl` for that job |
| Logged-in sender | Supabase Auth session cookie (magic link, password, or Google/GitHub OAuth) | `auth.users`; envelopes.`user_id` | Dashboard list, mint live keys. Pro extras only after Checkout |
| Machine | `Authorization: Bearer sign_tmp_…` or `sign_live_…` | sha256 + prefix, shown once | REST + MCP. Never a cookie. Never `?apiKey=` |
| Human signer | `/s/:token` (nanoid, hashed at rest) | Hash only; raw in invite email | Consent + draw. **Not an account to finish.** After complete, optional signup |

Hard rules:

- Keys authenticate the *caller*. They never sign and never auto-sign.
- The ceremony never requires Supabase Auth. `/s/:token` is enough to consent and Finish.
- After Finish (and in the completion email) we **offer** signup/login so they can see docs they signed. Pre-filled email. Soft CTA, not a wall.
- Free **send** path never bounces to `/login`.
- A logged-in signer may **download** envelopes they signed. They may not DELETE/cancel the sender’s job.
- Do not expose envelopes on the Supabase Data API. Route handlers talk to Postgres with the service role. RLS on; no grants to `anon`.

---

## 6. v1 API

This is the integration. Same paths for humans, `curl`, and agents. Included on self-host (no license key, no Pro 404).

```http
POST /v1/envelopes
Authorization: Bearer sign_tmp_… | sign_live_…   # omit → sender OTP, then tmp key

# multipart
title=Repair authorization
sender_email=shop@example.com
signers=[{"name":"Jane","email":"jane@example.com"}]
file=@form.pdf
```

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `POST` | `/v1/envelopes` | Create + send | None (OTP) or Bearer |
| `GET` | `/v1/envelopes` | List mine (sent or signed) | Session **or** live key |
| `GET` | `/v1/envelopes/:id` | Status + audit summary | Bearer (tmp or live) |
| `GET` | `/v1/envelopes/:id.pdf` | Signed (or 409 if not done) | Bearer |
| `DELETE` | `/v1/envelopes/:id` | Cancel / purge bytes (sender only) | Bearer |

Also: `GET /openapi.json`, `GET /llms.txt` (no auth). Errors are JSON `{ "error": string, "code": string }` with the obvious HTTP status (401, 403, 404, 409, 410, 429).

**Why this is enough for agents in v1:** one POST with PDF bytes, poll `GET :id` until `completed`, `GET :id.pdf`. Live key skips OTP. Human still signs. MCP is those three verbs. Webhooks (`envelope.completed`) after v1 — poll until then.

**PDF behavior in v1:** append a signature page, then PKCS#12 ByteRange seal, then SHA-256 of sealed bytes, then a **sibling** certificate PDF. Do not ship a field placer. Do not ingest a file URL (SSRF).

---

## 7. Money

Two public columns. Charge for **hosting, deliverability, and retention** — not for unlocking the API, not per seat, not per document.

Login is **not** a plan. “Team” is **not** a SKU (shared cabinet later, included in Pro). “Enterprise” is **not** a page.

Two clocks, never mixed: **`expires_at`** is time to sign; **`shred_at`** is how long we keep bytes after (or instead of) completion.

| | **Free** | **Pro · $19/mo** | **Self-host** |
|---|---|---|---|
| Login | Optional. Same product either way | Required (they already have an account) | Their users |
| Time to sign | **7 days** | **7 days** | Their policy |
| Keep signed file | **7 days after completion** (unsigned jobs shred when the link dies) | **1 year after completion** | Forever, their disk |
| Cabinet | No login: tmp key + email. Logged in: sent **and** signed this week | Year of files they sent or signed | Their disk |
| Live keys | After login, same free cap | Yes | Unlimited |
| Send | Quiet cap: **20 envelopes / 30 days / verified email** (abuse, not a homepage meter) | Fair use. Not per-doc | Unlimited |
| Footer | “Sent with …” | Off | Off |
| People on the cabinet | One inbox | v1: one login. Later: invite others to **this** cabinet, no per-person price, soft cap ~10 | Their problem |
| Branding / webhooks | No | After v1, **same $19** until a second SKU is obviously needed | Their problem |
| API | Same four endpoints | Same four endpoints | **Included. No license key. No per-doc tax.** |

Completion mail **still attaches** the PDF on Free. We do not hold the file hostage. Pro is the cabinet + cap lift + no footer, not “pay to receive what you signed.”

### Free copy (non-negotiable)

- Completion email + done screen: **Download this. We delete it on [date]. Keep it in a cabinet — [Create a free account].** Logged-in Pro: **Keep this a year.**
- No archive, no “retrieve for 30 days after delete,” no recovery theater.
- Never “log in to sign.” Always “you’re done — save this if you want.”

### Pro (the only paid SKU)

**$19/month** via **Stripe Checkout** (subscription). One Price (`STRIPE_PRICE_PRO`). No annual SKU. No trial (Free *is* the trial). No Personal vs Team vs Enterprise on the pricing page.

Webhook `checkout.session.completed` sets `accounts.plan = pro` and extends `shred_at` on their envelopes (+1 year from completion, or from now if already complete). `customer.subscription.deleted` / past_due sets `plan = free`; it does **not** instantly shred; it stops *new* jobs getting the 1-year keep. No payments-on-sign (the signer never pays us). No in-app seat billing. Stripe Customer Portal can wait.

Seed math: infra is ~$50–150/month until volume is real. A handful of Pro subscribers at $19 covers it. **Do not** give anyone a free private tier. Discount setup, not the product.

### After Pro, still not new plans

**v1 already includes** webhooks, decline, void, reminders, stdio **and** HTTP MCP. See §10.

**v1.1** (next slice, still $19, no new SKU), in this order:

1. **Branding** — logo + display name on emails and signing page. Certificate stays factual (who, when, IP). No custom domain.
2. **Saved packets** — “send this file again” (PDF + signer roles). No field editor.
3. **Team invites** — more people on **this** Pro cabinet. Not billed per person. Soft cap ~10.

**Later, only if asked:**

4. **Tags** — `{{sig}}` `{{date}}` `{{name}}` in the PDF, only if the extra signature page looks cheap. This is the on-ramp to a field placer — do not start here.
5. **7-year insurance hold** — first *candidate* for a second SKU. **Not unlimited** on our cloud.

**Drag-drop builder** — not on the roadmap. DocuSeal. Only if branding + packets + tags all fail.

**Enterprise** is an email when a 40-location chain wants a DPA, invoice, or SSO. We do not list it, price it, or build it until that buyer exists.

---

## 8. Legal (match DocuSeal’s *default* product, not their badge wall)

SOC 2, ISO 27001, HIPAA, 21 CFR Part 11, and eIDAS QES do **not** make a signature admissible. A US court does not ask whether the vendor was audited. It asks whether the *process* can show intent, consent, attribution, and a reproducible record. That is ESIGN + UETA.

**DocuSeal’s default signing product is Simple Electronic Signature (SES).** Email link + click/draw to sign + audit log + PKCS#12 seal. AES/QES, SOC 2, HIPAA, and 21 CFR are extras on their marketing page (QES is a paid partner add-on). We match the **default**. We do not claim the extras until they are true.

| ESIGN / UETA need | DocuSeal default | Sign (locked) |
|---|---|---|
| Consent to electronic records | Checkbox / consent clause before finish | Required checkbox. Finish is illegal without `consented_at` |
| Intent to sign | Active click / draw | Consent, then draw, then Finish |
| Attribution | Unique email (or SMS) link; IP / UA | Unique `/s/:token` emailed to that address; IP + UA. Signer OTP 2FA is later, optional, like theirs |
| Integrity | PKCS#12 on the PDF | PKCS#12 ByteRange seal, then SHA-256 of **sealed** bytes. Certificate is a **sibling** PDF so the hash is not lying |
| Audit / evidence | Certificate of Signature (audit log PDF) | Same job. See fields below |
| Retention | They keep until you delete (soft archive) | We email PDF+cert, keep 7 days (Free) or 1 year (Pro), then hard delete. The customer’s copy is the exhibit. Tombstone stays |

We are **not** weaker than default DocuSeal in court because we lack SOC 2. We **would** be weaker if we skipped consent, skipped the audit PDF, or claimed QES/PAdES/LTV we do not do.

### Copy we use (and do not)

Use: **electronic signatures designed to satisfy the ESIGN Act and UETA** (same legal effect as wet ink for transactions those laws cover). The signed PDF + completion certificate are the evidence package.

Do not use: “court admissible” as a guarantee, “notarized,” “qualified,” “PAdES,” “LTV,” “AES/QES,” “SOC 2,” “HIPAA,” “21 CFR Part 11,” “good enough for a California statutory POA.” No vendor can promise a judge will enforce a specific document. DocuSeal’s blog overclaims “enforceable in court”; we match their **process**, not that sentence.

Customers use **their** lawyer’s form. We do not draft it. Example file is a repair authorization / direction to pay. We refuse remote online notarization.

### Completion certificate (v1 — DocuSeal-class)

Sibling PDF, emailed with the sealed file. Print, at least:

- Envelope ID and title
- Sender email
- Per signer: name, email, `sent_at`, `opened_at`, `consented_at`, `signed_at` (and `declined_at` if any), IP, user-agent
- Authentication method, honestly: **Unique link sent to {email}**
- SHA-256 of the sealed PDF
- The consent sentence they checked
- Times in UTC
- “Not a notary. Not legal advice.”

Do not invent email-open pixels, session IDs, SMS, ID-document checks, or KBA on the cert. DocuSeal lists those when they actually ran them.

Signing-page checkbox must cover: agree to sign electronically; consent to electronic records; signature intended to be as binding as handwritten under applicable law. Counsel can replace the paragraph later; the checkbox cannot ship off.

**Abuse:** sender OTP on no-account sends, quiet **20 sends / 30 days / verified email** on Free (login does not lift it), rate limits, file-size cap, malware scan if cheap. Signing links expire. Tmp keys die with the file.

---

## 9. License

**Apache-2.0.** Not MIT, not AGPL. Patent grant; one LICENSE file; companies can use it without a copyleft scare.

- Self-host includes the API. That is the DocuSeal wound.
- Cloud is how we charge (email, storage, uptime).
- AGPL is how you scare companies and then sell them a commercial key. We are not doing that. Do not vendor AGPL competitor code.

---

## 10. v1 / not v1

### v1 — ship

- PDF upload (multipart bytes)
- One or more signers, sequential, no roles UI
- Auto signature page + PKCS#12 seal + sibling **DocuSeal-class** completion certificate (envelope id, parties, timestamps, IP/UA, email-link auth, SHA-256, consent sentence)
- OTP one-off → tmp key **or** logged-in live key (free cap still applies)
- Optional Supabase login (magic link, email+password, Google/GitHub OAuth — not a gate, not a plan); cabinet = sent **or** signed by proven email
- Post-sign funnel: done screen + completion email CTA to signup/login (does not block Finish)
- Stripe Checkout for **Pro $19/mo** (1-year keep, cap lift, footer off)
- Email both parties the PDF + certificate (Resend)
- 7-day ceremony; 7-day free keep after sign; Pro sets `shred_at` to +1 year
- Quiet free send cap (~20 / 30 days / verified email)
- REST: create, list, status, PDF, delete + `/openapi.json` + `/llms.txt`
- MCP: `send`, `status`, `download` — **stdio and HTTP** (`POST /mcp`). No `sign` tool
- Signing page that works on a phone, with required ESIGN/UETA consent checkbox
- **Decline** on the signing page; **void** = sender `DELETE`
- **Reminders** (same Cron as shred: pending signers at ~day 3 and ~day 6)
- **Webhook** `envelope.completed` (HMAC, no tokens in payload, SSRF deny-list). Poll still works.
- **Next.js App Router + shadcn/ui (Base UI primitives)** + Tailwind for `/`, `/s/[token]`, `/login`, cabinet, `/upgrade`

### v1 — do not ship

File URL ingest, seats, folders, template CMS, tenants, white-label domains, SSO/SAML, bulk CSV, **payments-on-sign**, conditional fields, SMS, 10-type form builder, tags/field overlay, per-document tax on self-host, industry-specific admin, drafted legal forms, **required** signer accounts / signup-to-sign, Stripe Customer Portal, team invites, branding, saved packets, a public Enterprise tier, annual billing, a second Stripe Price, SOC 2 / HIPAA / QES / “court admissible” claims.

### v1.1 (next slice, still Pro $19)

Branding → saved packets → team invites. See §7. No field placer. No new SKU.

### Later / never

Tags only if the extra signature page looks cheap. 7-year hold only if shops ask (new SKU). Builder never. URL ingest only if SSRF-proofed.

---

## 11. Cloud stack (locked)

**Vercel** (HTTP) + **Supabase** (data) + **Resend** (app mail) + **Stripe** (Pro). Self-host is `supabase start` + `next start` (no Stripe, no Resend required if they set SMTP).

| Need | Cloud | Self-host / tests |
|---|---|---|
| Compute | **Next.js** on Vercel Fluid Compute. Route Handlers for `/v1/*` + ceremony POSTs. **`runtime = nodejs`** (not Edge) | `next start` / Docker |
| Rows | **Supabase Postgres** + Drizzle | `supabase start`; PGlite in tests |
| Login | **Supabase Auth**: magic link, password, Google, GitHub | Same |
| PDFs | **Supabase Storage**, private bucket `envelopes` | Same API (local Storage) |
| Mail | **Resend** from Route Handlers (`emails.send`, attachments). Auth magic-link mail: point Supabase custom SMTP at Resend so one From domain | nodemailer SMTP or Resend |
| Pay | **Stripe Checkout** subscription **Pro $19/mo**; webhook Route Handler | Off. Forever keep, no meter |
| Shredder | **Vercel Cron** → `/internal/shred` | Same HTTP route or OS cron |
| MCP | stdio **and** HTTP in v1. Three tools | Same |
| UI | **Next.js App Router + Tailwind v4 + shadcn/ui on Base UI** | Same |

Invites, OTP, and completion (PDF+cert attached) go out from Route Handlers via Resend. Do not send those through Supabase Auth hooks.

Do not use Vercel Blob, `@vercel/postgres`, Edge runtime for seal/crypto, function filesystem for PDFs, PostgREST as the public API, **or Hono** (Next.js already is the HTTP layer).

**UI + API:** Next.js App Router. Pages + **Route Handlers** (`app/v1/.../route.ts`, `export const runtime = "nodejs"`). Tests call exported `GET`/`POST` with a Web `Request`. `npx shadcn@latest init -d --base base-ui`. Components live in `components/ui`. Primitives are **Base UI**, not Radix. Do not pull AI Elements (Radix-only). Do not put pdf-lib / `@signpdf` on Edge. Do not replace the four REST endpoints with Server Actions. shadcn is buttons, inputs, checkbox, cards; it is not a template CMS.

PDF module: `pdf-lib` + `@signpdf/signpdf` + placeholder-pdf-lib + signer-p12. Fail the envelope if seal throws.

---

## 12. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Product type | Primitive, not suite | DocuSeal bloat is the hole |
| Free path | No login; OTP + tmp key | Friction is the competitor |
| Login | Optional; Supabase magic link, password, Google, GitHub; **not a plan** | People want this week’s list; identity ≠ gate. SSO later |
| Packaging | **Free + Pro $19/mo.** No seats. No Enterprise page | Unlike DocuSign/DocuSeal. Team = later invites on Pro, same price |
| Machine creds | `sign_tmp_` (job) / `sign_live_` (user-minted, free after login) | Cookie is for browsers; keys are for `curl`/MCP. Free cap still applies |
| Signer | `/s/:token` to finish. Optional signup **after** | Ceremony stays a link. Cabinet is the growth loop |
| Funnel | Done screen + email → free account → Pro | Signers become senders. Never gate Finish |
| File | PDF-first, append signature page, then seal | Shops already have forms |
| Agent | REST + OpenAPI + llms.txt + MCP (stdio **and** HTTP) in v1 | Three tools wrap REST. Webhooks on complete. Human still signs |
| OSS vs cloud | Both; API free on self-host | Honest open source |
| License | Apache-2.0 | Not AGPL paywall theater |
| GTM | One public cloud, public price | Not a private fork; not an industry SKU |
| Free cloud | 7 days to sign; 7 days to keep; ~20 sends/30d quiet cap | Storage + abuse. Login does not lift the cap |
| Pro | $19/mo · 1 year keep · cap lift · footer off | One Stripe Price. Not unlimited |
| Cloud | Vercel (Next.js) + Supabase + Resend + Stripe | Pages + API + data + mail + pay |
| Files | Supabase Storage | Same project as Auth/Postgres; self-host works |
| Mail | Resend | Attachments; one From domain |
| Pay | Stripe Checkout · Pro $19/mo | 1-year keep + cap lift + no footer; not payments-on-sign |
| Branding vs templates | After v1: webhooks → reminders → branding → packets. Still $19 | Builder is how you become DocuSeal |
| Field placer | Not on roadmap | See above |
| Legal class | SES / ESIGN+UETA. Match DocuSeal **default**, not their badge wall | Court cares about process + evidence PDF, not SOC 2 |
| Legal copy | Customer’s form; repair auth, not statutory POA | We are not their attorney. No “court admissible” guarantee |
| Repo | `MAR3/sign` | Its own product. Not a suite SKU |
| HTTP | Next.js Route Handlers + Zod, Node runtime | No Hono, no tRPC, no Server Actions as the public API. Seal is not Edge |
| UI | Next.js + shadcn/ui on **Base UI** + Tailwind | Vercel-native pages. Not Radix |
| Name | TBD; working title Sign | See [name.md](./name.md). Do not ship as Secure Sign until the header is updated on purpose |

---

## 13. Open questions

1. **Name and domain.**
2. **7-year insurance hold** — candidate for a *second* SKU after shops ask; not on the pricing page now.

License is **Apache-2.0**. Login is magic link + password + Google/GitHub (SSO/SAML is not v1). **Signup-after-sign** is the funnel; signup-to-sign is forbidden. **v1 agents = REST + OpenAPI + llms.txt + MCP (stdio and HTTP) + `envelope.completed` webhook.** v1.1 = branding, packets, team invites. Packaging (Free + Pro $19), no seats, live keys on free login, quiet 20/30d cap, sequential N signers, stack, two-clock retention, Resend, Stripe Checkout, cabinet = sent or signed, SES / ESIGN+UETA matching DocuSeal’s **default**, and **Next.js** (pages + Route Handlers, shadcn on Base UI, no Hono, Node runtime, not Edge for seal) are **closed**.

---

## 14. First implementation slice

Task-level plan: [v1 walking skeleton](./superpowers/plans/2026-08-20-sign-v1.md).

Order:

1. Schema + shredder (Vercel Cron → Storage delete + tombstone).
2. `POST /v1/envelopes` with OTP → tmp key. `expires_at` = now+7d.
3. Signing page + seal + certificate. On complete, free `shred_at` = now+7d.
4. Email from Route Handlers via **Resend**.
5. Public one-off page (PDF drop + curl). GET/DELETE behind tmp key.
6. Supabase login (magic link, password, Google/GitHub); cabinet lists sent **and** signed; mint live keys. Post-sign CTA.
7. Stripe Checkout → webhook → **Pro** keep (+1 year), cap lift.
8. `/openapi.json` + `/llms.txt` + MCP stdio **and** HTTP (`send` / `status` / `download`).
9. Decline + reminders + `envelope.completed` webhook.

First dogfood: send a real PDF through the public cloud one-off.

---

## 15. Success

v1 is working when:

- Someone with no account can get a signed PDF back in email.
- That same person can `curl` status/download with the tmp key for seven days, then the file is gone.
- The **signer** can finish with no account, then create one from the done screen and see that doc in their cabinet.
- A logged-in user pays **Pro $19/mo** to keep files a year and that covers the server.
- A stranger can send without a sales call or a login.
- An agent can send with a live key, `POST /v1/envelopes` (or MCP `send`), and poll status.
- Self-host has the same API with no license key.
