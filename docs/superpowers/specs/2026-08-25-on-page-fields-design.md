# AgentSign Design — On-page fields, embed, parallel

**Date:** 2026-08-25  
**Status:** Locked for implementation  
**Product:** AgentSign  
**Repo:** [mar3co/AgentSign](https://github.com/mar3co/AgentSign)  
**Product plan:** [docs/2026-08-19-product-plan.md](../../2026-08-19-product-plan.md)  
**Depends on:** v1.2 on `main` (agent parties, OAuth, verify, templates as packets)  
**Supersedes:** tags half of [issue #1](https://github.com/mar3co/AgentSign/issues/1). Drag-drop placer and drafted legal language stay parked.

---

## 1. Intent

A DocuSeal client cannot move if the signature lives on an extra page. This slice makes a document **optionally have fields on the original pages**, then adds the integration bits that sit on that engine: prefill, collected values, iframe embed, parallel order, and webhook parity.

AgentSign stays a signing primitive. We are not building a form suite.

- Humans **Finish**. That is still the only ESIGN/UETA electronic signature.
- Agents **Attest**. Interactive fields cannot be assigned to an agent role.
- Keys still never Finish. No `sign` MCP tool. No API `completed: true` auto-sign.
- No fields on a document: today’s append-signature-page path is unchanged.
- Fields present: burn values onto the original pages, then the existing PKCS#12 seal and sibling certificate.
- Apache-2.0. Do not vendor DocuSeal. One SKU ($19 Pro). No per-document tax.

This spec overrides the product plan bullets that said “field placer / tags not on the roadmap” **for tags and API coordinates only**. It does not unlock a WYSIWYG builder, DOCX/HTML generation, QES, SOC 2, HIPAA, or indefinite cloud retention.

---

## 2. Non-goals

Not this spec:

- Drag-drop field placer, 19 field types, conditionals, formulas, autodetect
- DOCX `[[variables]]`, HTML-to-PDF, multi-file packets
- Typed or uploaded signatures (draw PNG only, as today)
- SMS, email 2FA, ID, KBA, QES, payments-on-sign
- Custom HTML email templates, customer SMTP From, custom domain
- Changing Free 7-day / Pro 1-year shred clocks
- Drafting the customer’s legal language
- A React/Vue/Angular SDK. Iframe + `postMessage` is the embed
- Printing SOC 2, HIPAA, QES, or “court admissible” anywhere

---

## 3. Product rules

| Rule | Decision |
|---|---|
| Field engine | JSON areas on the document. Tags and API `fields` are writers of the same JSON. A placer later is a third writer. |
| No fields | Append signature page per human, then seal. Today’s path. |
| Fields | Whiteout tags at create. Burn values at complete. Seal once. |
| Extra page | Append today’s appearance page only for a **human** who has **no** `signature` field. Agents never get a field; attestation stays on the certificate. If the document has fields and every human has a signature field, do not append any page. |
| Free vs Pro | One-off tagged PDF and `fields` on `POST /v1/documents` work on Free. Saved templates stay Pro (`403 pro_required` as today). Embed, `send_email`, parallel: all plans. |
| Self-host | Same API. `SELF_HOST=1` already entitles templates. |
| i18n | English only. |

---

## 4. Data model

### 4.1 Field JSON

Stored as jsonb on `documents.fields` and `templates.fields`. Default `[]`.

```ts
export const fieldTypes = [
  "signature",
  "initials",
  "date",
  "name",
  "text",
  "checkbox",
] as const;
export type FieldType = (typeof fieldTypes)[number];

export type FieldArea = {
  page: number; // 1-based
  x: number;    // percent of page width, 0-100, origin top-left
  y: number;    // percent of page height, 0-100, origin top-left
  w: number;    // percent of page width, > 0
  h: number;    // percent of page height, > 0
};

export type DocumentField = {
  name: string;          // unique per document among fields with the same role
  type: FieldType;
  role: string;          // matches signer.role_name
  required: boolean;     // default true for signature/initials/name/date; false for text/checkbox
  readonly: boolean;     // default false
  default_value?: string | boolean;
  areas: FieldArea[];    // at least one
};
```

Same `name` + `role` with multiple areas is **one** field (initials on every page). Duplicate `name`+`role` in the parsed list are merged by concatenating areas. Conflicting `type` / `required` / `readonly` on a merge is `400` `{ code: "invalid_fields" }`.

Limits: 200 fields per document, 20 areas per field. Area numbers finite, `w`/`h` > 0, `x,y,w,h` such that the box intersects the page (allow slight overflow; clamp at burn).

Percent + top-left matches DocuSeal’s area payload so a client can copy coordinates.

### 4.2 Columns

`documents` (new):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `fields` | jsonb | `[]` | `DocumentField[]` |
| `signing_mode` | text | `'sequential'` | `sequential` \| `parallel` |
| `send_email` | boolean | `true` | If false, mint links, do not send invite/reminder mail |
| `completed_redirect_url` | text | null | https URL, SSRF-checked |
| `embed_origin` | text | null | Origin only, e.g. `https://app.example.com` |

`signers` (new):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `role_name` | text | null | Assigned at create. If omitted, `Signer ${signingOrder}` |
| `values` | jsonb | `{}` | `{ [fieldName]: string \| boolean }` for this party. No PNGs. |

`templates` (new):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `fields` | jsonb | `[]` | Copied onto the document at send |

Signature/initials PNGs stay in blob store, not jsonb:

```
appearances/{documentId}/{signerId}/{fieldName}.png
```

Today’s single-appearance key `appearances/{documentId}/{signerId}` remains for the **no-fields** path only.

Migration: `drizzle/0004_on_page_fields.sql` with `ADD COLUMN IF NOT EXISTS`. Tests keep using PGlite `pushSchema`. Existing rows: `fields = []`, `signing_mode = sequential`, `send_email = true`, null redirect/origin, null `role_name`, `values = {}`. Treat null `role_name` as `Signer ${signingOrder}` at read time.

No feature flag. This is on.

### 4.3 Role mapping

1. Each signer may send `role` (string, 1–80 chars). Stored as `role_name`.
2. If omitted, `role_name = "Signer ${signingOrder}"` (`Signer 1`, `Signer 2`, …).
3. Every field.role must equal some signer’s `role_name`. Unknown role → `400` `{ code: "invalid_fields" }`.
4. Template send: field.role must equal a `template_roles.role_name`. Signers array order still matches `signing_order` as today; optional per-signer `role` must match that slot’s role_name if provided.
5. Interactive fields (`signature`, `initials`, `text`, `checkbox`, and non-readonly `date`/`name`) on a role whose party `kind` is `agent` → `400` `{ code: "invalid_fields" }`. Readonly `date`/`name`/`text` on an agent role is allowed (prefill only).
6. A document with `fields.length > 0` must include at least one human party. Otherwise `400` `{ code: "invalid_fields" }`.

---

## 5. Tag parser

Module: `src/lib/pdf/tags.ts`. Pure. No HTTP.

### 5.1 Grammar

A tag is `{{` + body + `}}`. Body is trimmed. No nested braces.

```
body        = alias | named
alias       = "sig" | "signature" | "initials" | "init" | "date" | "name"
named       = fieldName ( ";" pair )*
pair        = key "=" value
key         = "type" | "role" | "required" | "readonly"
```

`fieldName` is 1–80 chars, not empty, no `;`.

Aliases:

| Tag | name | type |
|---|---|---|
| `{{sig}}` / `{{signature}}` | `sig` / `signature` | `signature` |
| `{{initials}}` / `{{init}}` | `initials` / `init` | `initials` |
| `{{date}}` | `date` | `date` |
| `{{name}}` | `name` | `name` |

Named examples:

```
{{Full Name}}
{{Full Name;type=text}}
{{Agree;type=checkbox;required=true}}
{{sig;role=Customer}}
{{DOB;type=date;role=Signer 2;readonly=true}}
```

`{{Full Name}}` with no type is `text`.

`required` / `readonly` accept `true` / `false`. Default `required`: true for `signature`, `initials`, `name`, `date`; false for `text`, `checkbox`. Default `readonly`: false. Default `role`: `Signer 1`.

Unknown type or key → that tag is ignored as a field and left visible? **No.** Unknown type → `400` `{ code: "invalid_fields" }` so a client typo does not silently drop a signature.

### 5.2 Extraction

Use **pdfjs-dist** (legacy Node build) `getDocument` + `getTextContent` per page.

1. Concatenate adjacent text items on the same line (same transform y, overlapping/adjacent x) so `{{` `sig` `}}` still matches.
2. Regex `\{\{[^}]+\}\}` on the reconstructed line.
3. Map each match to a bbox from the contributing items’ transforms. pdfjs viewport is top-left px; convert to **percent of page** with origin top-left.
4. Minimum box after convert: signature/initials `w >= 15` and `h >= 4` (percent). If the tag bbox is smaller, expand around its center, clamped to the page.
5. Whiteout: load the same bytes with pdf-lib, draw a white rectangle over each tag bbox (convert percent back to pdf-lib points, origin bottom-left), save. That whiteout PDF is what we store as `original`.
6. Do not leave `{{...}}` visible on the stored original.

If pdfjs throws or the file has zero pages → `400` `{ code: "invalid_pdf" }`.

If the file has no tags, parser returns `{ fields: [], pdf: originalBytes }` with bytes unchanged.

Union: explicit API `fields` plus parsed tags. Same `name`+`role`: merge areas. Conflict on type/required/readonly: `400 invalid_fields`.

Tests ship a pdf-lib fixture that `drawText`s `{{sig}}` and `{{Full Name;type=text;role=Signer 1}}` at known points and assert parsed percents within ±1.0.

---

## 6. HTTP

Errors stay `{ error, code }`. New codes: `invalid_fields`, `invalid_values`, `embed_origin_invalid`.

### 6.1 `POST /v1/documents`

Multipart, additive. Existing fields unchanged.

| Form field | Required | Meaning |
|---|---|---|
| `fields` | no | JSON array of `DocumentField` (areas required if not using tags) |
| `values` | no | JSON object of prefill `{ [name]: string \| boolean }`. Applied to matching field names on **all** roles that have that name. Prefer per-signer values when a name exists on two roles. |
| `order` | no | `sequential` (default) or `parallel` |
| `send_email` | no | `true`/`false`. Default true |
| `completed_redirect_url` | no | https URL. Run existing webhook SSRF denylist. Reject http, redirects, private IPs. Max 2048 chars |
| `embed_origin` | no | Origin (`https://host[:port]`), no path, no trailing slash. `400 embed_origin_invalid` otherwise |

Signer JSON grows optional `role` and optional `values` (per-signer prefill, wins over document-level `values` for that name).

Create pipeline after PDF magic/size checks:

1. Parse tags → whiteout PDF + tag fields.
2. Parse `fields` JSON if present.
3. Union. Validate limits, roles, agent rule, and “fields imply at least one human.”
4. Apply prefill into each signer’s `values` for fields they own that have `default_value` or supplied values. Readonly missing a value → `400 invalid_values`.
5. Store whiteout (or original) bytes as `original`. Persist `fields`, mode, send_email, redirect, embed_origin, per-signer `role_name` + `values`.
6. Invite: see §8.

**Create response** (201) must include **every human** party’s `sign_url`, not only the first:

```json
{
  "id": "...",
  "status": "pending",
  "signers": [
    { "email": "a@x.com", "role": "Signer 1", "sign_url": "https://agentsign.co/s/..." },
    { "email": "b@x.com", "role": "Signer 2", "sign_url": "https://agentsign.co/s/..." }
  ]
}
```

Agent parties omit `sign_url`. `pending_sender` OTP path: no `sign_url`s until OTP succeeds (then the OTP handler returns them). Keep webhook_secret behavior.

Sequential: later `sign_url`s exist but `/s/:token` still 409 `sequential_wait` until prior party is done. Embedders can hold the URL.

### 6.2 `GET /v1/documents/:id`

Add:

```json
{
  "fields": [ ],
  "signing_mode": "sequential",
  "send_email": true,
  "signers": [
    {
      "role": "Signer 1",
      "values": { "Full Name": "Jane" },
      "sign_url": "https://..."
    }
  ]
}
```

`sign_url` is included for human parties when the caller is the document owner (tmp/live/session that already authorizes GET). Decrypt `token_enc` as reminders do. Hash-only legacy rows omit `sign_url`. Never put `sign_url` in webhooks.

`values` for signature/initials: `"[signed]"` if a PNG exists, omit or `null` if not. Do not return PNG bytes here.

### 6.3 Templates

`POST /v1/templates` multipart/JSON accepts `fields` the same shape. If a PDF file is uploaded, run the tag parser and union. `GET` / `PATCH` return/update `fields`. `PATCH` may replace `fields` entirely.

`POST /v1/templates/:id/send` copies template.fields onto the new document. Body may include `values`, `order`, `send_email`, `completed_redirect_url`, `embed_origin`, and per-signer `role` / `values`. Signer count must still equal role count.

MCP `send` / `send_template` grow the same optional args (`fields` as JSON string or object, `values`, `order`, `send_email`, `completed_redirect_url`, `embed_origin`).

### 6.4 Ceremony

| Method | Path | Change |
|---|---|---|
| `GET` | `/s/:token` (state JSON) | Include `fields` (this party only), `values` (this party), `signing_mode`, `completed_redirect_url`, `embed_origin` |
| `GET` | `/s/:token/preview` | **New.** Original (unsigned) PDF bytes for a pending signer who is allowed to open the ceremony. 409 sequential_wait / 410 expired as today. `content-disposition: inline` |
| `GET` | `/s/:token/pdf` | Unchanged: sealed/cert only after complete |
| `POST` | `/s/:token/sign` | If the document has fields for this party, require `values` JSON plus PNGs named `sig:<fieldName>` for each required signature/initials field. Keep accepting `png` as the file for the single signature field when there is exactly one. No-fields path: `png` as today |
| `POST` | `/s/:token/consent` | Unchanged. Still required before Finish |
| `POST` | `/s/:token/decline` | Unchanged |

`GET /s/:token/preview` must not leak other documents. Possession of the token is the credential, as today.

Finish with fields:

1. Consent required.
2. Sequential wait unless `signing_mode = parallel`.
3. Parse `values`. Coerce checkbox to boolean. `date` empty → UTC date of `now()` as `YYYY-MM-DD`. `name` empty → `signer.name`.
4. Every **required** field for this role must be present. Required checkbox must be `true`. Required signature/initials must have a PNG with `byteLength > 0`.
5. Readonly field values in the POST that disagree with stored values → `400 invalid_values`. Stored readonly wins.
6. Persist `signers.values`, PNGs to blob keys, `signed_at`.
7. If more parties remain, invite next (sequential) or just return pending (parallel).
8. If this completes the document, burn + seal (§7).

---

## 7. Burn and complete

New module `src/lib/pdf/burnFields.ts`:

```ts
export async function burnFields(
  original: Uint8Array,
  input: {
    fields: DocumentField[];
    parties: Array<{
      role: string;
      kind: "human" | "agent";
      name: string;
      email: string;
      signedAt: Date | null;
      values: Record<string, string | boolean>;
      pngs: Record<string, Uint8Array>; // fieldName → png
    }>;
  },
): Promise<Uint8Array>;
```

For each field, for each area, convert percent/top-left to pdf-lib points/bottom-left using that page’s size. Draw:

| type | draw |
|---|---|
| signature / initials | embed PNG, scale to box, preserve aspect, center |
| date / name / text | Helvetica, size min(h_pt * 0.6, 12), left, vertically centered, clip to box. Value stringified |
| checkbox | if true, draw an “X” in the box (two lines). if false, leave empty |

Then `completeDocumentPdf`:

1. If `fields.length === 0`: today’s loop of `appendSignaturePage` for every party appearance. Unchanged tests must pass.
2. If `fields.length > 0`: `burnFields` first. Then, for each **human** with no `signature` field, `appendSignaturePage` with their draw PNG (the no-box fallback). Agents do not get an appearance page on the fields path; the certificate already records attestation.
3. `sealPdf` as today.
4. Certificate: existing parties block, plus a “Fields” block listing `role`, `name`, `type`, text value (checkbox yes/no; signature/initials as “drawn”). No images on the cert. Hash is of sealed bytes after burn (and any fallback pages).

Create already rejects a fields document with zero human parties (§4.3, §6.1). `agent_only_attest` therefore never meets the fields complete path.

`verify` unchanged.

---

## 8. Invite, parallel, mail

`signing_mode = sequential` (default): today’s `inviteFirstSigner` / `inviteNextHumanIfNeeded`. `sequentialWait` stays.

`signing_mode = parallel`: at send, mint tokens for every human and send every invite (unless `send_email` is false). `sequentialWait` returns null when the document is parallel. Complete when every party is done (same `partyDone` + human-required rule as v1.2). Reminders: every pending human, same day-3/6 caps, skip if `send_email` is false.

`send_email = false`: mint and encrypt tokens, set `sent_at`, **do not** call the mailer for invites or reminders. Completion/decline mail still sends (the signed PDF). If that is wrong for a silent embed, we can add `send_completion_email` later. **Not this spec.**

---

## 9. Embed

No SDK. The embed is `/s/:token` in an iframe.

**CSP.** Signing page and `/s/:token/*` responses set:

```
Content-Security-Policy: frame-ancestors 'self' <embed_origin>
```

If `embed_origin` is null: `frame-ancestors 'self'`. Today we send no CSP, so this **tightens** default framing. Needed so random sites cannot frame a signing link. Embedders must pass `embed_origin`.

Also send `X-Frame-Options: SAMEORIGIN` only when `embed_origin` is null. When `embed_origin` is set, omit `X-Frame-Options` (it cannot express a third origin; CSP does).

**Client.** `signing-ceremony.tsx`: if `window.parent !== window`, on completed/declined:

```ts
window.parent.postMessage(
  { source: "agentsign", event: "completed" | "declined", id: documentId, status },
  embedOrigin,
);
```

`embedOrigin` is the document’s `embed_origin`. If it is null, do not `postMessage` (the iframe would have been blocked by CSP anyway). Include `id` in ceremony state JSON (document id is not secret relative to the token).

**Redirect.** After Finish/decline, if `completed_redirect_url` is set, `window.location` assign to it (top-level: `window.top.location` when framed). Append nothing. Do not put the token in the URL.

**Docs.** `/docs` and `/llms.txt`: iframe example, `embed_origin`, `send_email=false`, `postMessage` shape. No 40-attribute widget.

---

## 10. Ceremony UI

Today the ceremony is consent + one canvas. It does not show the PDF. With fields it must.

When `state.fields.length === 0`: keep the current canvas UI.

When fields exist:

1. Fetch `/s/:token/preview` and render pages with **pdfjs-dist** in the browser (same family as the server parser).
2. Overlay HTML boxes for this party’s areas (percent → CSS). Other parties’ fields are not shown as interactive; optional faint marks are unnecessary in v1 (the burned PDF is not previewed until complete).
3. Clicking a signature/initials box opens the existing canvas (modal or expanding the box). Saving puts a thumbnail in the box.
4. Text: input in the box. Date: `type=date` input, default today. Name: input defaulting to `signerName`. Checkbox: click toggles.
5. Readonly: rendered text, not editable.
6. Consent checkbox still required, still above Finish.
7. Finish disabled until consent + all required fields for this party.
8. Decline unchanged.
9. Mobile: boxes min 44px hit area. Canvas stays pointer-based as today.

Do not add a field placer on `/send` or `/templates`. Homepage drop: if the PDF contains tags, they work with no extra UI.

---

## 11. Webhooks

Envelope webhook (existing HMAC, `X-Sign-Timestamp`, no tokens) fires these events. Failed delivery still audits `webhook_failed` and does not throw.

| Event | When | Body (plus `id`, `status`) |
|---|---|---|
| `document.opened` | First `opened_at` for a human | `signer_email` |
| `signer.completed` | Human signed or agent attested | `signer_email`, `kind`, `values` (same redaction as GET) |
| `document.completed` | Seal succeeded | existing `sha256`, `shred_at`, plus `values`: array of `{ role, name, type, value }` |
| `document.declined` | Already fired | unchanged |
| `document.expired` | Already fired | unchanged |

Do not add `form.viewed` / `form.started`. `document.opened` is enough.

Agent `party.ready` unchanged.

---

## 12. OpenAPI, llms.txt, MCP

- OpenAPI 3.1: document `fields`, `values`, `order`, `send_email`, `completed_redirect_url`, `embed_origin`, GET shape, ceremony preview, webhook events. Version bump `info.version` to `2.1.0`.
- `/llms.txt`: one-off tagged PDF example; “human always signs”; iframe snippet; no `sign` tool.
- MCP `send` / `send_template` optional args as §6.3. Instructions string mentions fields. Still no `sign` tool.

---

## 13. Entitlement and abuse

Unchanged send cap, file size (20 MB), 7-day ceremony. Fields do not lift Free.

`completed_redirect_url` and `embed_origin` use the webhook SSRF denylist (no localhost, no link-local, no metadata hosts). `embed_origin` must be `https:` except `http://localhost` / `http://127.0.0.1` for dev.

---

## 14. Testing

TDD. `setDeps` / `resetDeps`. `fileParallelism: false` remains.

Must include:

**Parser**

- pdf-lib fixture with `{{sig}}` and `{{Full Name;type=text}}` parses to two fields; whiteout PDF no longer contains `{{sig}}` as extractable text
- Split items `{{` + `sig` + `}}` still parse
- Unknown type → `invalid_fields`
- Alias table: sig, initials, date, name

**Create**

- No fields: existing create/sign/seal tests still pass
- Tags only: stored `documents.fields` nonempty; original blob is whiteout
- API `fields` only: no pdfjs needed
- Union merge areas; type conflict 400
- Agent role + signature field 400
- Fields + zero humans 400
- Readonly without value 400
- Prefill per-signer wins over document values
- Free one-off with tags succeeds
- Template create stores fields; send copies them

**Ceremony / complete**

- Sequential wait still 409 with fields
- Parallel: both humans open and Finish without wait; complete after the second
- Required checkbox false → 400; true → burns an X
- Signature PNG burned inside the box (pdf bytes contain the PNG; no extra page if every human had a signature field)
- Human without signature field still gets an appended page
- Consent still required
- Decline unchanged
- Certificate lists field values; SHA-256 matches sealed

**Embed / mail**

- `send_email=false` mints URLs, recorded mail has no invite
- Create returns all human `sign_url`s
- Ceremony `postMessage` payload shape (jsdom: stub parent)
- CSP `frame-ancestors` includes embed_origin
- Redirect URL to blocked host 400 at create

**Webhooks**

- `document.opened` HMAC verifies
- `document.completed` includes values, not `sign_url`

**MCP**

- `send` with fields JSON round-trips
- No `sign` tool registered

---

## 15. Key decisions

1. **Tags + API coordinates, not a builder.** Same JSON either way. Placer can wait.
2. **Percent + top-left + 1-based page.** Copyable from DocuSeal areas.
3. **No-fields path frozen.** Append page remains the default when `fields` is empty.
4. **Burn then seal.** Hash covers the burned (and any fallback) bytes.
5. **At least one human on a fields document.** Avoids agent-only + boxes.
6. **Interactive fields are human-only.** Agents Attest; they do not fill boxes.
7. **Iframe + postMessage, not an SDK.**
8. **Default CSP `frame-ancestors 'self'`.** Embedders opt in with `embed_origin`.
9. **`send_email=false` still sends the completion PDF.** Silent complete-mail is later.
10. **Free may use tags on one-offs.** Templates stay Pro.
11. **No new SKU, no per-doc fee, no QES/SOC2/HIPAA claims, no DOCX/HTML engine.**
12. **pdfjs-dist** for tag positions (server) and ceremony preview (client). One family.

---

## 16. Suggested build order

1. Schema + Zod `DocumentField` + migration `0004`.
2. `tags.ts` parser + whiteout + fixture tests.
3. `burnFields` + `completeDocumentPdf` fields path + complete-pdf tests.
4. Create/template persist fields, prefill, role_name, all `sign_url`s.
5. Ceremony state, preview PDF, Finish `values` + PNGs, sequential still default.
6. Ceremony UI: pdfjs overlay when fields exist; keep canvas-only when not.
7. Embed: CSP, `embed_origin`, `send_email`, `completed_redirect_url`, `postMessage`.
8. Parallel `signing_mode` + reminder skip when `send_email` false.
9. Webhooks `document.opened`, `signer.completed`, values on completed.
10. MCP, OpenAPI 2.1.0, llms.txt, `/docs` iframe example.

Do not add a placer, a `sign` tool, or HTML/DOCX in any step.

---

## 17. PR Plan

Each PR is independently reviewable and leaves `pnpm test` green.

| # | Title | Depends | Files / components | What |
|---|---|---|---|---|
| 1 | Schema and field types | — | `src/db/schema.ts`, `src/db/dev-schema.ts`, `drizzle/0004_on_page_fields.sql`, `src/lib/pdf/fields.ts` (Zod), `src/test/schema.test.ts` | Columns, defaults, Zod parse/reject |
| 2 | Tag parser and whiteout | 1 | `src/lib/pdf/tags.ts`, `src/test/tags.test.ts`, `package.json` (pdfjs-dist) | Extract, merge, whiteout, aliases |
| 3 | Burn-in and complete | 1 | `src/lib/pdf/burnFields.ts`, `src/lib/pdf/complete.ts`, `src/lib/pdf/certificate.ts`, `src/test/complete-pdf.test.ts` | Fields path + no-fields regression |
| 4 | Create, templates, prefill | 2 | `src/routes/documents.ts`, `src/routes/templates.ts`, `src/test/create-document.test.ts`, `src/test/templates.test.ts` | Persist fields, roles, all sign_urls |
| 5 | Ceremony Finish with fields | 3, 4 | `src/routes/signing.ts`, `src/test/signing.test.ts` | Preview, values, sequential, complete |
| 6 | Ceremony overlay UI | 5 | `app/s/[token]/signing-ceremony.tsx`, `app/s/[token]/page.tsx`, UI tests | pdfjs pages + boxes; old UI if no fields |
| 7 | Embed | 5 | signing routes + ceremony + `src/test/signing.test.ts` | CSP, postMessage, redirect, send_email |
| 8 | Parallel + webhooks | 5 | `src/routes/signing.ts`, `src/lib/webhooks.ts`, `src/jobs/shred.ts`, webhook/signing tests | order=parallel, new events, values on complete |
| 9 | MCP, OpenAPI, llms | 4–8 | `src/mcp/server.ts`, `src/openapi.ts`, `app/llms.txt/route.ts`, `app/docs/page.tsx`, mcp tests | Surface only; no `sign` tool |

PRs 6 and 8 can proceed in parallel after 5. PR 7 after 5 (UI can land with a stub postMessage before overlay, but overlay should ship in the same milestone).

---

## 18. Maintenance

- Future placer writes `DocumentField[]`. Do not invent a second coordinate system.
- Future typed-signature is a ceremony input that still becomes a PNG before burn.
- `completeDocumentPdf` must keep the no-fields loop; do not merge it with burn “for simplicity.”
- Watch pdfjs-dist + Next.js bundling (`serverExternalPackages` already used for PGlite). Put Node pdfjs in `serverExternalPackages` if webpack tries to bundle the worker.
- Product plan and issue #1 should be updated in PR 9 copy: tags shipped; placer still parked.
