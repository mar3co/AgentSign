# OSS e-sign competitor research for Sign

Editor synthesis, 2026-08-20. Prefer **VERIFIED** (opened in `/tmp/sign-competitor-research/{docuseal,documenso,opensign,sendsign,libresign,signbee}`). Dive text not in that set is **UNVERIFIED**. Do not treat competitor OpenAPI as Sign’s API.

This file is a snapshot of competitor code. Product decisions made after it (Vercel + Supabase + Resend + Stripe, Storage not Blob, 7-day sign / 7-day free keep / 1-year Pro at $19/mo, tmp vs live keys, optional login that is not a plan, no seats) live in [`docs/2026-08-19-product-plan.md`](../2026-08-19-product-plan.md) and the [v1 plan](../superpowers/plans/2026-08-20-sign-v1.md). **Sign is its own product** (not a suite SKU, not an industry fork).

Thesis check: DocuSeal/DocuSign-class products are document platforms; Sign is a primitive — send / sign / fetch. **Apache-2.0** (locked). PDF-first, append a signature page, 7-day hard delete, four REST verbs, three MCP tools, human always signs.

## Verdict vs our plan

The hole is real. Five of six “OSS DocuSign alternatives” are **suites under copyleft**. The sixth is a **thin MCP client of closed SaaS**. None ships Sign’s combination: permissive license + API included on self-host + PDF blob + N signers + 7-day shredder + 3 agent tools.

| Competitor | Closest to Sign | Why we are not them |
|---|---|---|
| **Signbee** | No-account `POST /send`, optional Bearer, MCP, 7-day *link* expiry | Public repo is wrapper-only (**VERIFIED** `signbee/src/index.ts`). Engine is proprietary. Markdown-first, two-party, API key skips the human sender, privacy retains signed PDFs **7 years**. |
| **SendSign** | Four-table envelope/doc/signer/audit, Bearer keys, MCP | 16 MCP tools (**VERIFIED**), field placer, send never mails (**UNVERIFIED** dive), fake PAdES, default retention 2555 days, LICENSE BSD vs README AGPL (**VERIFIED**). |
| **DocuSeal** | `/s/:slug` possession URL, hash-only MCP token, PKCS#12 seal | **VERIFIED** AGPLv3 + §7(b) UI attribution. Template-first. OSS cannot `POST /api/templates`; HTML/PDF/DOCX one-offs 404 as Pro. Soft-archive, not shred. |
| **Documenso** | `/sign/{token}` nanoid URL, `api_` hashed keys, async seal | **VERIFIED** AGPL-3.0 + commercial EE. Envelope + 11-type field placer. Plaintext tokens. Dual V1 REST / V2 tRPC. No MCP. |
| **OpenSign** | Completion-gated P12 PKCS#7 + SHA-256 + cert PDF | **VERIFIED** AGPL (server `package.json` falsely says MIT). Parse/Mongo, ~55 Cloud functions, 16-widget placer. Guest OTP 4-digit/plaintext. No OSS API keys, no MCP. |
| **LibreSign** | Per-signer UUID page, hashed 6-digit OTP, SHA-256 of sealed bytes | **VERIFIED** AGPL-3.0-or-later Nextcloud app. Default engine JSignPdf (JVM). 70+ routes. Files live until a manager deletes. No MCP. |

**Plan holds.** Do not vendor any of them. Reimplement the primitive. Charge for hosting/deliverability/retention, never for unlocking the API.

## Comparison matrix

| | **Sign (plan)** | DocuSeal | Documenso | OpenSign | SendSign | LibreSign | Signbee |
|---|---|---|---|---|---|---|---|
| **License** | Apache-2.0 | AGPLv3 + §7(b) attribution **VERIFIED** `LICENSE`, `LICENSE_ADDITIONAL_TERMS` | AGPL-3.0 + EE commercial **VERIFIED** `LICENSE`, `packages/ee/LICENSE` | AGPL-3.0; server.json MIT lie; broken `customRoute` carve-out **VERIFIED** | LICENSE BSD-3 + CoSeal branding; README AGPL **VERIFIED** | AGPL-3.0-or-later Nextcloud **VERIFIED** `COPYING`, `REUSE.toml` | Wrapper MIT (no LICENSE file); engine proprietary **VERIFIED** `package.json:26` |
| **Product unit** | PDF blob + signers | Template → Submission (no template, no send) **VERIFIED** OSS templates have no create | Envelope + items + 11 FieldTypes **VERIFIED** `schema.prisma` | `contracts_Document` + Placeholders JSON **UNVERIFIED** dive | Envelope + fields (11 types) **UNVERIFIED** dive; four core tables **VERIFIED** | `libresign_file` + `file_element` boxes **UNVERIFIED** dive | Hardcoded sender+recipient **UNVERIFIED** hosted OpenAPI |
| **REST** | `POST /v1/envelopes`, `GET :id`, `GET :id.pdf`, `DELETE :id` | OSS: templates index/show/update/destroy; HTML/PDF/DOCX Pro 404 **VERIFIED** `errors_controller.rb`, `routes.rb` | Dual deprecated V1 ts-rest + V2 tRPC-OpenAPI **UNVERIFIED** | ~55 Parse.Cloud.define; hosted API v1.1 not in tree **VERIFIED** `main.js` | DocuSign-class surface; README four curls **UNVERIFIED** | Nextcloud session API; 70+ v1 routes **UNVERIFIED** | Hosted OpenAPI: send, generate, GET/DELETE `/documents/{id}` **UNVERIFIED** (not in clone) |
| **Auth (sender)** | Bearer optional; omit → hashed 6-digit OTP. Key **is** the account. | Dashboard Devise; REST SHA-256 of `X-Auth-Token`; AccessToken also encrypts raw token **UNVERIFIED** | `api_{16}` SHA512, shown once **UNVERIFIED** dive | Parse.User; no bearer keys in OSS **UNVERIFIED** | Bearer or `?apiKey=` or env `===` **UNVERIFIED** | Nextcloud session; no app API keys **UNVERIFIED** | Optional Bearer; no key → `pending_sender` **VERIFIED** wrapper + OpenAPI security |
| **Auth (signer)** | Hashed nanoid at `/s/:token`; possession is credential | 14-char `base58` slug at `/s/:slug`; 2FA opt-in **VERIFIED** | plaintext `nanoid()` at `/sign/{token}` **VERIFIED** | `/login/{btoa(docId/email)}`; OTP off by default **UNVERIFIED** | 72h UUID `/sign/:token`; OTP is `console.log` **UNVERIFIED** | SignRequest UUID `/p/sign/{uuid}`; hashed 6-digit OTP **UNVERIFIED** (UUID split **VERIFIED**) | Hosted phone page; sender OTP vs key-skip **UNVERIFIED** engine |
| **PDF** | Append signature page; org P12 ByteRange; SHA-256 **after** seal; sibling cert PDF | HexaPDF overlay + `pdf.sign` PKCS#12; audit-trail PDF; LTV no-op in OSS **UNVERIFIED** | Flatten, append Konva cert, `@libpdf/core` ETSI.CAdES.detached **UNVERIFIED** | Widgets burned client-side; P12 PKCS#7 **only if last signer**; SHA-256 stored **VERIFIED** `PDF.js` | pdf-lib overlay + watermark; node-forge PKCS#7 test-only; complete even if seal throws **UNVERIFIED** | Pkcs12Handler (default JSignPdf) vs PKCS7_DETACHED `.p7s`; “PAdES” overstated **VERIFIED** factory, keep=false | Hosted: pdf-lib last A4 page + SHA-256, **not** PKCS#7 **UNVERIFIED** (no engine in clone) |
| **Retention** | Free: 7-day **hard** delete. Paid: 1y. Self-host: their disk. | Soft-archive unless `permanently=true`; `expire_at` webhooks only **UNVERIFIED** | Completed = `deletedAt`; default expiry 3 months **UNVERIFIED** | `IsArchive`; TimeToCompleteDays default 15 **UNVERIFIED** | Default 2555 days (~7y) **UNVERIFIED** | Nextcloud nodes until manager DELETE; `expiry_in_days` 365 **UNVERIFIED** | Link expiry default 7d (max 30); **privacy 7-year store**; DELETE revokes pending only **UNVERIFIED** privacy |
| **MCP** | 3 tools: send / status / download. Same hashed Bearer. | 5 tools incl. `create_template` / `search_templates`; hash-only `McpToken` **UNVERIFIED** | **None** **VERIFIED** (grep empty) | **None** **VERIFIED** | 16 tools, not README’s 17 / sidecar README’s 5 **VERIFIED** `mcp-server/src/index.ts` | **None** **VERIFIED** | Exactly 2 tools, both `POST /api/v1/send`; no status/download **VERIFIED** |
| **Email** | Invite with `/s/:token`; complete attaches PDF+cert; “Download this. We delete it on [date].” | Sidekiq; completed attaches PDF+audit (10MB) **UNVERIFIED** | React Email; invite `/sign/{token}`; complete attaches PDFs; `distributionMethod` EMAIL\|NONE **UNVERIFIED** | Invite CTA; complete attaches PDF+`certificate.pdf` **UNVERIFIED** | Templates exist; `sendEnvelope` never calls them **UNVERIFIED** | Link only; **no** `addAttachment` **UNVERIFIED** | Hosted Resend; wrapper has no mailer **VERIFIED** |
| **Field placer** | **Not on roadmap.** Append a page. | 19 types, 52-file Vue builder **UNVERIFIED** | 11 FieldTypes, send blocked without SIGNATURE **VERIFIED** enum | 16 Konva/react-dnd widgets **UNVERIFIED** | 11 types, send blocked without signature field **UNVERIFIED** | `@libresign/pdf-elements` llx/ury **UNVERIFIED** | None (append cert page) **UNVERIFIED** hosted |
| **Self-host honesty** | Same API. No license key. No per-doc tax. | API-key settings on self-host; cloud hides unless DEMO; HTML/PDF APIs Pro **VERIFIED** Pro 404s | AGPL network copyleft + EE paywall for SSO/embed/billing **VERIFIED** | Hosted REST/webhooks as upsell; OSS has no API keys **UNVERIFIED** | API included; branding clause; README license lie **VERIFIED** license | Coupled to Nextcloud users/files **VERIFIED** app | Not self-hostable (engine closed) **VERIFIED** wrapper-only |

## Steal for v1 (verified first)

Only these seven items were independently opened and marked `keep_for_sign=true`. Copy the *practice*, not the code.

1. **Unguessable per-signer URL; possession is the default credential** — DocuSeal. `Submitter.slug` = `SecureRandom.base58(14)`; create serializes `embed_src` = `/s/:slug`; `SubmitFormController` skips login. Email/link 2FA opt-in. **VERIFIED** `app/models/submitter.rb`; `lib/submitters/serialize_for_api.rb:47-50`; `config/routes.rb:153`. Sign: `POST /v1/envelopes` returns `{sign_url}` per signer. First skeleton is that page.

2. **Capability-token signing URL, no signer account** — Documenso. `Recipient.token = nanoid()`, indexed, `formatSigningLink` → `/sign/{token}`; Remix `_recipient+/sign.$token` uses `getOptionalSession`. **VERIFIED** `create-envelope-recipients.ts:116`; `schema.prisma` Recipient; `sign.$token+/_index.tsx`. Sign should **hash** the token at rest (Documenso stores plaintext — avoid that).

3. **OTP-without-key send** — Signbee (documented contract). Omit `Authorization` on `POST /api/v1/send` → `pending_sender` + “verification email sent”. OpenAPI security `[{bearerAuth:[]},{}]`. **VERIFIED** wrapper `src/index.ts:9,72-74,110-121` + published OpenAPI/llms.txt. Engine source **not** in the clone — do not invent their OTP implementation. Sign: same dual auth on `POST /v1/envelopes`. Key authenticates the *caller*; it never signs.

4. **Seal only on last human complete; store SHA-256 of sealed bytes** — OpenSign. `if (isCompleted) { SignPdf + P12Signer; documentHash = sha256(signedDocs) }`. Placeholder `SUBFILTER_ADOBE_PKCS7_DETACHED`. **VERIFIED** `apps/OpenSignServer/cloud/parsefunction/pdf/PDF.js:49-50,132-134,497-520`; `Placeholder.js:29`. Sign: append a signature page *then* seal; hash **after** PKCS#7.

5. **Four-table primitive** — SendSign. `envelopes` + `documents(storagePath, documentHash)` + `signers(token, consentedAt, ip, ua)` + `audit_events`. **VERIFIED** `src/db/schema.ts:110-118,148-159,172-196,250-267`. Ignore their `fields`/templates/tenants.

6. **Document UUID ≠ per-signer UUID** — LibreSign. File uuid for identity/validation; SignRequest uuid for `/p/sign/{uuid}` in the email. **VERIFIED** `lib/Db/File.php`, `SignRequest.php`; `MailService.php:63`; `PageController.php:368`. Sign: envelope UUID for status/download/delete (Bearer); signer token for `/s/:token`.

7. **OSS one-off file→signature is the wound to occupy** — DocuSeal. OSS REST cannot create templates; OpenAPI still documents `POST /submissions/{pdf,html,docx}` and `POST /templates/{pdf,html,docx}`; `ErrorsController` returns Pro 404. **VERIFIED** `errors_controller.rb` `ENTERPRISE_PATHS`; `config/routes.rb` templates `only: %i[update show index destroy]`; `docs/openapi.json`. Sign: `POST /v1/envelopes` takes a PDF + signers. Never require a UI-built template. Never 404 the API behind a seat.

**Aligned but UNVERIFIED** (use as design notes, re-verify before coding):

- Hash-only API keys shown once: DocuSeal `McpToken` (`sha256` + 5-char prefix, never stored) vs their revealable `AccessToken`; SendSign `sendsign_<64 hex>`; Documenso `api_{16}` SHA512. Prefer McpToken shape + timing-safe compare. Prefix `sign_live_`.
- Submitter timestamps as the status machine: DocuSeal `sent_at/opened_at/completed_at/declined_at` + ip/ua (`submitter.rb`, `schema.rb:400-427`).
- Sequential default: mail next signer only after `signed_at` (DocuSeal `submitters_order` preserved; OpenSign `SendinOrder`).
- Completion mail attaches PDF + certificate (DocuSeal 10MB cap; OpenSign `sendMailWithAttachment.js`). LibreSign/SendSign send a URL only — do not copy that.
- HMAC webhook `timestamp.hmac_sha256` + 5-min skew (DocuSeal `X-Docuseal-Signature`). Persist subscriptions. Never put signing tokens in payloads (Documenso does).
- Hashed 6-digit OTP, 10 min, 5 tries (LibreSign `TokenService.php`; OpenSign *delete-account* knobs — not their signing OTP).
- ESIGN consent + IP/UA before Finish (SendSign schema; their UI proceeds if consent POST fails — do not copy the fail-open).
- `/openapi.json` + `/llms.txt` on day one (Signbee). None of the OSS suites do this well.
- Phone ceremony as one public page (DocuSeal `/p/:slug` QR; LibreSign `/p/sign/{uuid}`). No embed SDKs.

## Avoid (suite traps)

License / honesty

- AGPL network copyleft (DocuSeal, Documenso, OpenSign, LibreSign). DocuSeal §7(b) forces “DocuSeal” in UIs. Documenso EE splits billing/SSO/embed. OpenSign’s `customRoute` dual-license is broken (no LICENSE in that dir). SendSign LICENSE is BSD-3 + “Powered by CoSeal”; README badges AGPL. **Stay Apache-2.0. Do not vendor their code.**

API / product gravity

- Template-first REST: submissions 422 without `template.fields` (DocuSeal). Field CRUD, folders, versions, dynamic HTML.
- Community vs Pro API tax: documented paths that 404 with a pricing URL (DocuSeal `errors_controller.rb`). Cloud-gating API settings.
- Dual public APIs (Documenso V1 + V2 tRPC). Parse Cloud ~55 functions (OpenSign). 70+ Nextcloud routes (LibreSign). SendSign’s real router vs README’s four curls.
- MCP template CRUD (`search_templates` / `create_template` → builder URL). 16-tool suites. Marketing 17 / 5 while code registers 16 (SendSign). Send-only MCP (Signbee).
- Dead `can?(:manage, :pro_thing)` branches and `/upgrade` → vendor console.

PDF / crypto theater

- Field placer as the product (DocuSeal HexaPDF areas, OpenSign `embedWidgetsToDoc`, Documenso Field x/y, SendSign percent coords, LibreSign llx/ury). Send blocked without a signature field.
- Appearance-only “seal”: paint images then `pdf.save`; stuff PKCS#7 into PDF Subject JSON (SendSign `crypto/sealer.ts` unused in production; `completeEnvelope` succeeds if seal throws).
- Claiming PAdES/LTV while `maybe_enable_ltv` is a no-op (DocuSeal OSS).
- Hash-only last-page certificate presented as a digital signature (Signbee SES).
- Chicken-egg: SHA-256 the PDF then append a cert page the hash does not cover. Print hash on a **sibling** PDF after the seal.
- HexaPDF, JSignPdf JVM, mPDF/TCPDF footers, Playwright/browserless certs, 100-year self-signed Root/Sub CA, per-signer ephemeral leaves, user PFX upload, CSC/TSP.
- Client-side widget burn before `signPdf` (OpenSign). Flatten+append+sign stays one server module.

Auth / tokens

- Revealable encrypted API tokens (DocuSeal `AccessToken`). `?apiKey=` query. Env key `===` compare. Auto-create-admin-on-first-use.
- Plaintext signing tokens in DB, emails, **and webhook bodies** (Documenso). Reversible `btoa(docId/email)` (OpenSign). Sequential integer ids as capability URLs.
- 4-digit OTP, `console.log` of codes, plaintext OTP rows, Parse `/loginAs` with master key, `masterKeyIps 0.0.0.0/0`, OTP-off-by-default fetch/sign (OpenSign). In-memory OTP Map (SendSign).
- **API key pre-verifies the sender so a human never signs** (Signbee `pending_recipient` / “skip sender verification”). Agent never holds signing authority.

Retention / webhooks / email

- Soft-archive as default (DocuSeal `archived_at` unless `permanently=true`; OpenSign `IsArchive`; Documenso completed `deletedAt`).
- `expire_at` jobs that only fire webhooks (DocuSeal `ProcessSubmissionExpiredJob`). 7-year / 2555-day store (SendSign, Signbee privacy). Revoke-without-purge (Signbee DELETE).
- S3 versioning + unversioned `DeleteObject`. Hardcoded PBKDF2 salt (SendSign `'sendsign-document-encryption-salt!'`). PDFs as `BYTES_64` in Postgres (Documenso default). Public buckets / `max-age=31536000`.
- Webhook auth as a copied shared-secret header or empty secret (Documenso `X-Documenso-Secret: secret ?? ''`). In-memory webhook Map (SendSign).
- Completion mail that is a download URL only (SendSign, LibreSign). Consent UI that continues when consent POST fails. Unwired `sendSigningRequest` (SendSign).

## Recommended stack for Sign

Boring TypeScript unless a clone forced otherwise — none did. Plan §10 already pointed here.

| Layer | Pick | Why (competitor evidence) |
|---|---|---|
| Runtime | Node + TypeScript ESM | MAR3 house style. SendSign/Signbee/Documenso are TS; DocuSeal Ruby and LibreSign PHP are suite hosts, not primitives. |
| HTTP | Next.js Route Handlers + Zod (plan later dropped Hono) | Four routes. No tRPC, no Parse, no Nextcloud OCP. |
| DB | Postgres: envelopes, signers, audit_events, api_keys | SendSign four-table **VERIFIED**. Never Mongo/Parse, never BYTEA PDFs. |
| Blobs | S3/R2/MinIO via `@aws-sdk/client-s3` | Keys on the envelope. Versioning **off**. Short-lived presigned GET. |
| Crypto at rest | AES-256-GCM, random 12-byte IV, pack `iv\|tag\|ct`; wrap with env/KMS | Copy SendSign layout, not their hardcoded salt. |
| PDF compose | `pdf-lib` 1.17 load / flatten / `addPage` / `drawImage`, `useObjectStreams: false` | OpenSign/SendSign/Signbee hosted. Helvetica/Courier Letter/A4. No Playwright, Konva, HTML-to-PDF. |
| PDF seal | `@signpdf/signpdf` + `placeholder-pdf-lib` + `signer-p12` | OpenSign Adobe.PPKLite ByteRange, SHA-256. Later optional swap to `@libpdf/core` ETSI.CAdES.detached (Documenso). **Not** HexaPDF, JSignPdf, TCPDF, node-forge-as-PAdES. |
| Hash | `crypto.createHash('sha256')` of **sealed** bytes | OpenSign `generateDocumentHash`; LibreSign `signed_hash`. |
| Mail | Resend (cloud), nodemailer SMTP (self-host), Postmark as bounce-webhook alternative | Plan. Three React Email templates only. |
| Jobs | pg-boss or a cron: seal on last sign; shred at `shred_at` | Do not copy Inngest monorepo or Sidekiq-as-product. |
| MCP | `@modelcontextprotocol/sdk` + zod, stdio first | Signbee size, SendSign client shape, **three tools**. |
| Auth libs | Bearer `timingSafeEqual`; OTP bcrypt/argon2 row; nanoid hashed | DocuSeal McpToken + LibreSign IHasher. No ROTP in the skeleton. |

Self-host: same binary, same four endpoints, MCP always on, no `ENABLE_MCP` gate, no Pro 404, no license key.

## Envelope + audit data model

v1 is **not** Documenso Envelope-as-CMS and **not** DocuSeal Template. It is SendSign’s four tables minus fields, plus LibreSign’s id split, plus DocuSeal’s signer timestamps.

```
envelopes
  id              uuid pk
  status          pending_sender | pending | completed | declined | cancelled | expired | deleted
  title           text
  sender_email    text
  expires_at      timestamptz     -- ceremony clock (link dies)
  shred_at        timestamptz     -- bytes clock (default now()+7d cloud free)
  original_key    text null       -- object store
  sealed_key      text null
  cert_key        text null
  sha256          text null       -- of sealed PDF, written after PKCS#7
  webhook_url     text null
  created_at

signers
  id, envelope_id
  name, email, role='signer'      -- no CC/viewer/assistant in v1
  token_hash                      -- sha256 of nanoid; raw only in email
  token_prefix                    -- optional lookup
  sent_at, opened_at, consented_at, signed_at, declined_at
  ip, ua, consent_ua
  signing_order                   -- sequential default: mail i+1 after signed_at

documents                         -- or three keys on envelopes; either is fine
  kind            original | sealed | certificate
  storage_path, document_hash

audit_events                      -- append-only, never CASCADE-wipe with the PDF
  envelope_id, signer_id?
  event           sent | opened | consented | signed | emailed | otp_sent
                  | email_verified | declined | expired | deleted
  ip, ua, payload jsonb           -- never include raw signing tokens
  created_at

api_keys
  prefix          sign_live_…
  token_hash      sha256          -- raw shown once
  expires_at?, created_at
```

Rules: envelope UUID for owner GET/DELETE/download (Bearer). Signer token for `GET /s/:token` only — cannot read sibling signers or the PDF API. `DELETE` on pending voids tokens and purges bytes (not archive). Sweeper at `shred_at` unlinks objects, nulls keys, inserts `deleted` tombstone, redacts emails. Two clocks: `expires_at` ≠ `shred_at`. Do not reuse DocuSeal `expire_at` (webhook only) or Signbee’s 7-day link vs 7-year store.

## PDF signing decision

v1 procedure, one server module, **fail the envelope if any step throws**:

1. Last human signs on the phone page (drawn PNG + typed name). Consent POST must succeed first.
2. `pdf-lib`: flatten AcroForm if present; **append a signature page** (PNG, name, email, time). Do not overlay fields on original pages.
3. Normalize PDF version (LibreSign: SHA-256 signatures want 1.6+; Documenso upgrades to 1.7). `save({ useObjectStreams: false })` so ByteRange placeholders survive.
4. `@signpdf` P12 ByteRange, `Adobe.PPKLite` / `adbe.pkcs7.detached`, SHA-256. One org PKCS#12 from env (`PFX` + passphrase); generate RSA-2048 self-signed at boot if missing. No user `.pfx`, no per-signer leaf, no TSA/LTV/DocMDP in v1.
5. Persist `sha256(sealed bytes)` on the envelope. **Then** compose a **separate** one-page certificate (parties, timestamps, IP, consent, hash, verify URL). Optionally PKCS-sign the cert too. Do not append the cert to the hashed PDF after hashing.
6. Email sealed PDF + `certificate.pdf` to sender and signers (10MB cap). Body: **Download this. We delete it on [date].**

What we are explicitly not doing: HexaPDF, JSignPdf, Playwright certs, Signbee hash-as-signature, SendSign Subject-JSON “PAdES”, OpenSign client-side widget burn, 100-year CA theater.

## Auth: OTP one-off vs key vs signing link

Three credentials, three jobs. Do not collapse them.

| Who | Credential | Storage | Used for |
|---|---|---|---|
| One-off sender | 6-digit email OTP | bcrypt/argon2 + `expires_at` + attempts on the envelope (LibreSign IHasher). 10 min, 5 tries, 30s resend. | Prove they own `sender_email` so `POST /v1/envelopes` without a key is not an open relay. Status `pending_sender` until verified. |
| Developer / agent | `Authorization: Bearer sign_live_…` | sha256 + 5-char prefix, shown once (DocuSeal `McpToken`). Timing-safe compare. Header only — never `?apiKey=`. | Account. Same key for REST and MCP. Optional expiry. |
| Human signer | `/s/:token` (nanoid) | **Hash at rest.** Raw token only in the invite email. Separate IP rate limit (~20/min, SendSign). | Consent + draw. Not OTP-gated in v1. Possession is enough. |

Hard rules from the plan and the dives:

- Key **never** signs and **never** skips a human signer. Signbee’s “pre-verified via API key” is the legal hole.
- Signer email-OTP is **not** the default gate (DocuSeal default is slug possession; OpenSign OTP-off is too open — we keep the unguessable token, not the open fetch).
- Do not implement ROTP/HOTP in the skeleton (Documenso advertises 5 min while HOTP is 30s window=1). Hashed row with explicit expiry.
- Self-host: env fallback `SIGN_API_KEY` hashed or compared with `timingSafeEqual`, plus hashed keys. Skip auto-create-admin.
- Status/download/delete require owner Bearer. Signer token cannot fetch `/v1/envelopes/:id.pdf`.

## MCP mapping

Sign v1 tools are 1:1 with REST. Agent prepares and sends. **No `sign` / `complete` tool.**

| MCP tool | REST | Notes |
|---|---|---|
| `send` | `POST /v1/envelopes` | Multipart PDF + `signers[]`. Optional Bearer. No key → `pending_sender` + OTP tip (Signbee copy). With key still emails the **signer** a link. Accept bytes, not a world-readable `pdf_url`, not dummy markdown. |
| `status` | `GET /v1/envelopes/:id` | Compact text: `envelope_id`, `status`, `expires_at`, `shred_at`, next human action. Not a dashboard URL (DocuSeal `documents_url`). |
| `download` | `GET /v1/envelopes/:id.pdf` | Actually GET the PDF (or an auth-gated URL). Do not concatenate a path client-side (SendSign `downloadSigned`). |

Do not ship: `create_template` / `search_templates` / `load_template` (DocuSeal), templates/bulk/analytics/retention/webhooks/legal-review (SendSign 16), Signbee’s send-only pair. One hash-only key for REST and MCP — do not add a second encrypted AccessToken. stdio first (Claude Desktop); Streamable HTTP later at `POST /mcp` protocolVersion `2025-11-25`. Never `Access-Control-Allow-Origin: *`. Self-host: MCP always on. Publish `/openapi.json` and `/llms.txt` listing the four paths, three tool names, optional Bearer on send, and “human always signs.”

## First walking skeleton (ordered)

Matches the product plan’s first slice. First dogfood: a real PDF through the public cloud one-off.

1. **Schema + shredder.** Four tables above. Daily job: if `now() >= shred_at`, delete object keys, null paths, append `deleted`, redact emails. `DELETE /v1/envelopes/:id` is that purge immediately.
2. **`POST /v1/envelopes`.** Multipart PDF + `signers[]` + `sender_email`. No Bearer → hash OTP, mail it, return `pending_sender`. Bearer → skip sender OTP, create signer tokens, return `{id, sign_url[]}`.
3. **`GET /s/:token` phone page.** No account. PDF preview, required ESIGN checkbox, draw-to-PNG, Finish blocked until consent POST stores `consented_at` + ip/ua. Sequential: later signers wait.
4. **Seal module.** On last `signed_at`: append signature page, P12 ByteRange, write `sha256`, write cert PDF. If seal throws, envelope stays pending — do not mark completed.
5. **Mail.** Three templates: sender OTP, signer invite (one CTA, sender, title, expiry, “if unexpected contact the sender”), completion with PDF+cert attached and shred date in the body. Self-host requires SMTP.
6. **`GET /v1/envelopes/:id`** (status + audit summary), **`GET /v1/envelopes/:id.pdf`**, **`DELETE`**. Bearer required. Optional `webhook` on create: HMAC-SHA256 of `${ts}.${rawBody}`, 5-min skew, SSRF deny-list, persist row, never include tokens.
7. **Public one-off drop** (same engine). Homepage: PDF drop hero + `curl` on the same screen.
8. **MCP sidecar** wrapping send/status/download. `/openapi.json` + `/llms.txt`.
9. **Magic-link key.** Email shows `sign_live_…` once. Hash at rest. Instant key is the account — no org wizard, no “create your first template.”

N signers, sequential, no roles UI (plan open question #5 — recommendation already in the plan).

## What we still should not copy

- Any AGPL file, even “just the sealer.” Reimplement.
- Field placer, tags, folders, templates, saved packets (packets are a **paid extra after** branding; not skeleton).
- Template-bound submissions, Pro 404s, tRPC, Parse, Nextcloud Files, markdown→PDF, `generate` preview-without-signing.
- CC / viewer / assistant / sequential-dictate-next / embed SDKs / SMS / SSO / Stripe / bulk CSV.
- Revealable API tokens, query-string keys, plaintext signing tokens, 4-digit OTPs, master-key `loginAs`.
- API-key-as-signer (Signbee). `completed=true` server-side auto-sign (DocuSeal API). Click-to-sign replacing OTP as the *sender* gate.
- Soft-archive, 7-year presets, MCP `manage_retention`, S3 versioning-as-backup.
- In-memory webhooks, empty webhook secrets, unsigned callbacks as the only integration.
- Branding clauses (“Powered by …”) as a license condition.
- Putting Sign under a suite catalog in code or README. Plan: its own product, one public cloud, public price.

## Unverified / needs a human

These were in the dives or on the public web and were **not** independently opened, or the clone cannot prove live behavior. Do not code from them until someone re-reads the file.

- **Signbee engine.** Clone is MCP-only. Hosted OpenAPI four paths, 7-year privacy, pdf-lib cert page, Resend, BetterAuth, Free 5/mo — all **UNVERIFIED** against server source. Steal item #3 is the *documented client contract* only. A live `POST` was not executed.
- **DocuSeal** webhook HMAC, AccessToken encrypt, MCP tool list, HexaPDF `pdf.sign`, 100-year CA, `ProcessSubmissionExpiredJob` webhook-only, default `send_email=true`, API `completed=true` bypass — dive/theme, not in the verified set except Pro 404s and `/s/:slug`.
- **Documenso** seal handler, Playwright-deprecated certs, webhook empty-secret, `delete-document` soft/hard split, `distributionMethod NONE` — not re-opened. Verified: license, Envelope+11 fields, plaintext token URL, no MCP.
- **OpenSign** invite `btoa` URLs, 4-digit OTP + `loginAs`, widget list, `IsArchive`, Mailgun — not in verified set except license, Parse/55 functions, completion-gated P12+SHA-256.
- **SendSign** `sendEnvelope` never emails; PKCS#7 test-only; in-memory webhooks; 2555-day retention; `?apiKey=`; consent fail-open — strong dive claims, **UNVERIFIED** here except schema four-table, 16 MCP tools, license mismatch.
- **LibreSign** hashed OTP, no `addAttachment`, JSignPdf default, `signed_hash`, callback webhook, keep-forever Files — UUID split and engine factory were opened; OTP/mail/retention were not. “PAdES” in the original claim is **overstated** (factory is PKCS#12 vs PKCS7_DETACHED; no ETSI profile in production).
- **TCPDF** is not in current trees (theme note). Do not cite it as a live competitor choice.
- **Name/domain** still open (plan §12). Working title Sign. Do not ship as Secure Sign until the plan header is updated on purpose.
- **License** Apache-2.0 (locked in the product plan).
- No clone was built or integration-tested; line numbers refer to trees as of this research drop.
