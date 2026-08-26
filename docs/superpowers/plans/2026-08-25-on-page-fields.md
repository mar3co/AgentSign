# On-page fields, embed, and parallel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signatures and field values burn onto the original PDF pages; iframe embed and parallel order sit on that engine so a DocuSeal-style client can move without a field builder.

**Architecture:** `DocumentField[]` jsonb on documents and templates. Tags and API `fields` both write that JSON. Ceremony walks the current party’s fields, Finish stores `signers.values` plus per-field PNGs, complete runs `burnFields` then the existing PKCS#12 seal. No-fields documents keep `appendSignaturePage`. Embed is CSP `frame-ancestors` plus `postMessage`. Parallel skips `sequentialWait` and invites every human at send.

**Tech Stack:** Existing Next.js 15 Route Handlers, Drizzle, PGlite, Vitest, pdf-lib, `@signpdf`, Zod, MCP SDK, shadcn/Base UI. Add `pdfjs-dist` (legacy Node build for tags; same package in the ceremony client for preview). Do not add a form-builder library. Do not vendor DocuSeal.

**Spec:** [docs/superpowers/specs/2026-08-25-on-page-fields-design.md](../specs/2026-08-25-on-page-fields-design.md)

## Global Constraints

- Product name **AgentSign**. Keys stay `sign_tmp_` / `sign_live_` / `sign_agent_`. Apache-2.0. Do not commit secrets or `.grok/`.
- Humans Finish. Agents Attest. No `sign` MCP tool. No API `completed: true`. Keys never Finish.
- Field types this slice: `signature` | `initials` | `date` | `name` | `text` | `checkbox` only.
- Areas: 1-based page, x/y/w/h **percent of page**, origin **top-left**. Convert to pdf-lib points/bottom-left only inside burn/whiteout.
- `fields.length === 0` must keep today’s append-page complete path. Do not merge it with burn.
- A fields document must have at least one human party. Interactive fields cannot be assigned to an agent role.
- Free one-off tagged PDF is allowed. Templates stay Pro (`403 pro_required`).
- Default CSP on `/s/*` is `frame-ancestors 'self'`. Embedders pass `embed_origin`.
- `send_email=false` skips invite and reminder mail. Completion mail still sends.
- Errors `{ error, code }`. New codes: `invalid_fields`, `invalid_values`, `embed_origin_invalid`.
- HTTP: Route Handlers + Zod, `runtime = "nodejs"`. Tests: exported handlers + `new Request`. `setDeps` / `afterEach(resetDeps)`. `fileParallelism: false`.
- TDD: failing test first, watch it fail, then production. Commit after each task.
- After every schema change run `UPDATE_DEV_SCHEMA=1 npx vitest run src/test/dev-offline.test.ts` so `src/db/dev-schema.ts` regenerates.
- Do not add a placer UI, DOCX/HTML engine, QES/SOC 2/HIPAA copy, typed signatures, or a second SKU.

## File structure

```
src/lib/pdf/fields.ts              # Zod DocumentField, role helper, merge, percent↔pdf rect
src/lib/pdf/tags.ts                # pdfjs extract + whiteout
src/lib/pdf/burnFields.ts          # draw values onto pages
src/lib/pdf/complete.ts            # fields path then seal
src/lib/pdf/certificate.ts         # Fields block
src/lib/storage.ts                 # fieldAppearanceKey
src/lib/embed.ts                   # parseEmbedOrigin, ceremonyCsp
src/db/schema.ts                   # new columns
drizzle/0004_on_page_fields.sql
src/routes/documents.ts            # parse fields/values/order/send_email/embed, all sign_urls
src/routes/templates.ts            # fields on create/get/patch/send
src/routes/signing.ts              # preview, Finish values, sequentialWait vs parallel
src/routes/otp.ts                  # return all sign_urls after OTP
src/lib/webhooks.ts                # opened / signer.completed / values on completed
src/jobs/shred.ts                  # skip reminders when send_email is false
src/mcp/server.ts                  # optional fields/values/order/send_email
src/openapi.ts                     # 2.1.0
app/s/[token]/preview/route.ts
app/s/[token]/signing-ceremony.tsx
middleware.ts                      # CSP for /s/*
next.config.ts                     # serverExternalPackages pdfjs-dist
```

---

### Task 1: Schema and field types

**Files:**
- Create: `src/lib/pdf/fields.ts`
- Modify: `src/db/schema.ts` — `documents`, `signers`, `templates`
- Create: `drizzle/0004_on_page_fields.sql`
- Modify: `src/lib/storage.ts` — `fieldAppearanceKey`
- Test: `src/test/schema.test.ts`, `src/test/fields.test.ts`
- Regenerated: `src/db/dev-schema.ts` via `UPDATE_DEV_SCHEMA=1`

**Interfaces:**
- Consumes: drizzle `jsonb`, `boolean`, `text`; existing `documents` / `signers` / `templates`
- Produces:

```ts
// src/lib/pdf/fields.ts
export const fieldTypes = [
  "signature", "initials", "date", "name", "text", "checkbox",
] as const;
export type FieldType = (typeof fieldTypes)[number];

export type FieldArea = {
  page: number; x: number; y: number; w: number; h: number;
};
export type DocumentField = {
  name: string;
  type: FieldType;
  role: string;
  required: boolean;
  readonly: boolean;
  default_value?: string | boolean;
  areas: FieldArea[];
};

export function defaultRoleName(signingOrder: number): string;
export function parseFieldsJson(raw: unknown): 
  | { ok: true; fields: DocumentField[] }
  | { ok: false; error: string; code: "invalid_fields" };
export function mergeFields(a: DocumentField[], b: DocumentField[]):
  | { ok: true; fields: DocumentField[] }
  | { ok: false; error: string; code: "invalid_fields" };
export function areaToPdfRect(
  pageWidth: number, pageHeight: number, area: FieldArea,
): { x: number; y: number; w: number; h: number };
```

`defaultRoleName(1)` is `"Signer 1"`. Limits: 200 fields, 20 areas, name/role 1–80 chars. `required` default true for signature/initials/name/date, false for text/checkbox. Merge concatenates areas when `name`+`role` match; conflicting type/required/readonly is `invalid_fields`.

```ts
// src/lib/storage.ts
export function fieldAppearanceKey(
  documentId: string, signerId: string, fieldName: string,
): string; // `${documentId}/appearance/${signerId}/${encodeURIComponent(fieldName)}.png`
```

Keep existing `appearanceKey` for the no-fields path.

Schema columns (drizzle + SQL `ADD COLUMN IF NOT EXISTS`):

- `documents.fields` jsonb not null default `[]`
- `documents.signing_mode` text not null default `'sequential'`
- `documents.send_email` boolean not null default true
- `documents.completed_redirect_url` text null
- `documents.embed_origin` text null
- `signers.role_name` text null
- `signers.values` jsonb not null default `{}`
- `templates.fields` jsonb not null default `[]`

Use `sql`'[]'::jsonb`` / `sql`'{}'::jsonb`` for jsonb defaults.

- [ ] **Step 1: Write the failing tests**

```ts
// src/test/fields.test.ts
import { describe, expect, it } from "vitest";
import {
  areaToPdfRect, defaultRoleName, mergeFields, parseFieldsJson,
} from "../lib/pdf/fields.js";

it("defaultRoleName is Signer N", () => {
  expect(defaultRoleName(1)).toBe("Signer 1");
  expect(defaultRoleName(2)).toBe("Signer 2");
});

it("parses a signature field and rejects unknown type", () => {
  const ok = parseFieldsJson([{
    name: "sig", type: "signature", role: "Signer 1", required: true, readonly: false,
    areas: [{ page: 1, x: 10, y: 20, w: 30, h: 8 }],
  }]);
  expect(ok.ok).toBe(true);
  const bad = parseFieldsJson([{
    name: "sig", type: "payment", role: "Signer 1", required: true, readonly: false,
    areas: [{ page: 1, x: 10, y: 20, w: 30, h: 8 }],
  }]);
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.code).toBe("invalid_fields");
});

it("merges areas for the same name+role and rejects type conflict", () => {
  const a = parseFieldsJson([{
    name: "sig", type: "signature", role: "Signer 1", required: true, readonly: false,
    areas: [{ page: 1, x: 10, y: 20, w: 30, h: 8 }],
  }]);
  const b = parseFieldsJson([{
    name: "sig", type: "signature", role: "Signer 1", required: true, readonly: false,
    areas: [{ page: 2, x: 10, y: 20, w: 30, h: 8 }],
  }]);
  expect(a.ok && b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  const merged = mergeFields(a.fields, b.fields);
  expect(merged.ok).toBe(true);
  if (merged.ok) expect(merged.fields[0]!.areas).toHaveLength(2);
  const conflict = mergeFields(a.fields, [{ ...a.fields[0]!, type: "text" }]);
  expect(conflict.ok).toBe(false);
});

it("areaToPdfRect converts percent top-left to pdf-lib bottom-left on Letter", () => {
  const r = areaToPdfRect(612, 792, { page: 1, x: 0, y: 0, w: 50, h: 10 });
  expect(r.x).toBe(0);
  expect(r.w).toBe(306);
  expect(r.h).toBeCloseTo(79.2);
  expect(r.y).toBeCloseTo(792 - 79.2);
});
```

Also extend `src/test/schema.test.ts` “inserts a document” to expect `fields` `[]`, `signingMode` `"sequential"`, `sendEmail` `true`, and a signer insert to persist `roleName` / `values`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/fields.test.ts src/test/schema.test.ts`

Expected: FAIL (module or columns missing).

- [ ] **Step 3: Implement schema + `fields.ts` + `fieldAppearanceKey` + SQL**

Zod parse in `parseFieldsJson`. Do not accept extra field types.

- [ ] **Step 4: Regenerate dev schema and run tests**

Run: `UPDATE_DEV_SCHEMA=1 pnpm test src/test/dev-offline.test.ts src/test/fields.test.ts src/test/schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/fields.ts src/db/schema.ts src/db/dev-schema.ts drizzle/0004_on_page_fields.sql src/lib/storage.ts src/test/fields.test.ts src/test/schema.test.ts
git commit -m "Add document field types and schema columns."
```

---

### Task 2: Tag parser and whiteout

**Files:**
- Create: `src/lib/pdf/tags.ts`
- Modify: `package.json` — dependency `pdfjs-dist` (current 4.x or 5.x, pin what `pnpm add pdfjs-dist` resolves)
- Modify: `next.config.ts` — add `"pdfjs-dist"` to `serverExternalPackages`
- Test: `src/test/tags.test.ts`
- Helper: extend `src/test/pdf.ts` with `taggedPdf()` if useful

**Interfaces:**
- Consumes: `parseFieldsJson` not required; produce `DocumentField[]` then `mergeFields` with API fields in Task 4. `areaToPdfRect` for whiteout.
- Produces:

```ts
export type ParseTagsResult = { fields: DocumentField[]; pdf: Uint8Array };
export async function parsePdfTags(bytes: Uint8Array): Promise<ParseTagsResult>;
```

Use `pdfjs-dist/legacy/build/pdf.mjs` with `disableWorker: true` and `isEvalSupported: false`. Per-page `getTextContent`. Concatenate adjacent items on the same line. Match `\{\{[^}]+\}\}`. Convert item transforms to percent top-left. Expand signature/initials boxes to at least `w >= 15`, `h >= 4` percent around the tag center, clamped to the page.

Whiteout: `PDFDocument.load`, white rectangle over each tag bbox (percent → pdf-lib via `areaToPdfRect`), `save`. Returned `pdf` is that whiteout (or original bytes if no tags).

Aliases (name, type): `sig`/`signature` → signature; `initials`/`init` → initials; `date` → date; `name` → name. Named `{{Full Name}}` with no type → `text`. Default role `Signer 1`. Default required: true for signature/initials/name/date, false for text/checkbox. Unknown type or key: throw an error the HTTP layer maps to `400 invalid_fields`. In `parsePdfTags`, return/throw:

```ts
export class InvalidFieldsError extends Error {
  code = "invalid_fields" as const;
}
```

Unknown type throws `InvalidFieldsError`.

Zero pages or pdfjs throw: the HTTP layer will map to `invalid_pdf` in Task 4. Here, rethrow a normal Error with message `invalid_pdf` or let pdfjs throw.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { parsePdfTags } from "../lib/pdf/tags.js";

async function drawTags(labels: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 700;
  for (const label of labels) {
    page.drawText(label, { x: 72, y, size: 12, font });
    y -= 24;
  }
  return doc.save();
}

it("parses {{sig}} and a named text tag and whites them out", async () => {
  const bytes = await drawTags(["{{sig}}", "{{Full Name;type=text;role=Signer 1}}"]);
  const result = await parsePdfTags(bytes);
  const names = result.fields.map((f) => f.name).sort();
  expect(names).toEqual(["Full Name", "sig"]);
  expect(result.fields.find((f) => f.name === "sig")?.type).toBe("signature");
  const again = await parsePdfTags(result.pdf);
  expect(again.fields).toEqual([]);
});

it("joins split {{ sig }} items", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("{{", { x: 72, y: 700, size: 12, font });
  page.drawText("sig", { x: 84, y: 700, size: 12, font });
  page.drawText("}}", { x: 102, y: 700, size: 12, font });
  const result = await parsePdfTags(await doc.save());
  expect(result.fields.some((f) => f.type === "signature")).toBe(true);
});

it("unknown type throws invalid_fields", async () => {
  const bytes = await drawTags(["{{Pay;type=payment}}"]);
  await expect(parsePdfTags(bytes)).rejects.toMatchObject({ code: "invalid_fields" });
});
```

If the split-item fixture cannot be joined because pdf-lib emits one string anyway, keep the test: implementation must still concatenate adjacent same-line items so a real Word PDF works.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/tags.test.ts`

Expected: FAIL (`parsePdfTags` missing).

- [ ] **Step 3: `pnpm add pdfjs-dist`, implement `tags.ts`, add `serverExternalPackages`**

- [ ] **Step 4: Run tests**

Run: `pnpm test src/test/tags.test.ts src/test/fields.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml next.config.ts src/lib/pdf/tags.ts src/test/tags.test.ts
git commit -m "Parse PDF field tags and white them out."
```

---

### Task 3: Burn-in and complete

**Files:**
- Create: `src/lib/pdf/burnFields.ts`
- Modify: `src/lib/pdf/complete.ts`
- Modify: `src/lib/pdf/certificate.ts` — optional Fields block
- Test: `src/test/complete-pdf.test.ts`, `src/test/burn-fields.test.ts`

**Interfaces:**
- Consumes: `DocumentField`, `areaToPdfRect`, existing `completeDocumentPdf` / `appendSignaturePage` / `sealPdf` / `buildCertificate`
- Produces:

```ts
export type BurnParty = {
  role: string;
  kind: "human" | "agent";
  name: string;
  email: string;
  signedAt: Date | null;
  values: Record<string, string | boolean>;
  pngs: Record<string, Uint8Array>;
};

export async function burnFields(
  original: Uint8Array,
  input: { fields: DocumentField[]; parties: BurnParty[] },
): Promise<Uint8Array>;
```

`completeDocumentPdf` grows optional `fields?: DocumentField[]` and `fieldParties?: BurnParty[]`.

Logic:

1. `!fields?.length` → today’s appearance-page loop. Existing tests must keep page count 2 for one signer (original + append).
2. `fields.length > 0` → `burnFields` first. Then `appendSignaturePage` only for humans in `fieldParties`/`appearances` whose role has **no** `type === "signature"` field. Agents: no extra page on this path.
3. Then `sealPdf` as today.
4. `CertificateInfo.fields?: { role: string; name: string; type: string; value: string }[]`. After the parties block, if present, print `Fields` then `role name (type): value`. Signature/initials value is `drawn`. Checkbox is `yes` / `no`.

Burn drawing: PNG scaled into box (aspect, centered). Text/date/name: Helvetica, size `min(h * 0.6, 12)`, left, vertically centered, clip. Checkbox true: two diagonal lines (an X).

- [ ] **Step 1: Write the failing tests**

Keep the existing “seals then hashes; page count 2” test untouched.

Add:

```ts
it("burns a signature into the original page and does not append when every human has a signature field", async () => {
  const p12 = makeDevP12("test");
  const original = await minimalPdf();
  const fields = [{
    name: "sig", type: "signature" as const, role: "Signer 1",
    required: true, readonly: false,
    areas: [{ page: 1, x: 10, y: 80, w: 40, h: 10 }],
  }];
  const result = await completeDocumentPdf({
    original,
    appearances: [{ png, name: "Jane", email: "jane@example.com", signedAt: new Date() }],
    fields,
    fieldParties: [{
      role: "Signer 1", kind: "human", name: "Jane", email: "jane@example.com",
      signedAt: new Date(), values: {}, pngs: { sig: png },
    }],
    p12, passphrase: "test",
    meta: {
      documentId: "00000000-0000-0000-0000-0000000000f1",
      title: "Repair authorization",
      senderEmail: "shop@example.com",
      consentText: "I agree.",
      signers: [{
        name: "Jane", email: "jane@example.com",
        sentAt: new Date(), openedAt: new Date(), consentedAt: new Date(),
        signedAt: new Date(), declinedAt: null, ip: "1.2.3.4", ua: "test",
      }],
      fields: [{ role: "Signer 1", name: "sig", type: "signature", value: "drawn" }],
    },
  });
  const sealedDoc = await PDFDocument.load(result.sealed);
  expect(sealedDoc.getPageCount()).toBe(1);
  expect(Buffer.from(result.certificate).includes(Buffer.from("sig"))).toBe(true);
});
```

Add a checkbox-true burn test in `burn-fields.test.ts` that loads the burned PDF page and asserts the bytes changed vs original.

Add a human-without-signature-field case: one text field only, appearance PNG provided → page count 2 (burn + append).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/complete-pdf.test.ts src/test/burn-fields.test.ts`

Expected: FAIL on new cases; existing complete-pdf tests still pass until you touch `complete.ts` — if you touch it, keep them green.

- [ ] **Step 3: Implement `burnFields` and wire `completeDocumentPdf` + certificate**

- [ ] **Step 4: Run tests**

Run: `pnpm test src/test/complete-pdf.test.ts src/test/burn-fields.test.ts`

Expected: PASS (old page-count-2 no-fields test included).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/burnFields.ts src/lib/pdf/complete.ts src/lib/pdf/certificate.ts src/test/complete-pdf.test.ts src/test/burn-fields.test.ts
git commit -m "Burn field values onto the original PDF before seal."
```

---

### Task 4: Create, templates, and prefill

**Files:**
- Modify: `src/routes/documents.ts` — `createDocument`, `sendPreparedPdf`, `getDocument`, `inviteFirstSigner` (extract invite helper)
- Modify: `src/routes/otp.ts` — after verify, return all human `sign_url`s
- Modify: `src/routes/templates.ts` — `fields` on create/get/patch/send; `templateJson`
- Create: `src/lib/embed.ts` — `parseEmbedOrigin` (used more in Task 7; origin validation here)
- Test: `src/test/create-document.test.ts`, `src/test/templates.test.ts`

**Interfaces:**
- Consumes: `parsePdfTags`, `parseFieldsJson`, `mergeFields`, `defaultRoleName`, `parseEmbedOrigin`
- Produces: persisted `documents.fields`, signer `role_name` + `values`; create 201 `signers[].sign_url` for every human

`parseEmbedOrigin(raw: string): { ok: true; origin: string } | { ok: false; code: "embed_origin_invalid" }`

Rules: URL with no path (or `/` only), no search/hash. Protocol `https:` or `http:` with hostname `localhost` / `127.0.0.1`. Strip trailing slash. Reject blocked hosts from `webhookUrlError`’s host list without requiring DNS if you only parse the origin (do not DNS-resolve embed origins).

`completed_redirect_url`: `await webhookUrlError(url)` (https + SSRF). Max 2048 chars.

Create pipeline after PDF checks:

1. `parsePdfTags(bytes)` → `tagFields`, `storedBytes`. Catch `InvalidFieldsError` → 400 `invalid_fields`. Other throw → 400 `invalid_pdf`.
2. Optional form `fields` JSON → `parseFieldsJson`.
3. `mergeFields`.
4. If `fields.length > 0` and no human party → 400 `invalid_fields`.
5. Map signers: `role` or `defaultRoleName(i+1)`. Every `field.role` must match a signer `role_name`. Interactive field on agent role → 400 `invalid_fields`.
6. Prefill: document-level `values` then per-signer `values`. Readonly field without a value → 400 `invalid_values`.
7. Store `storedBytes` as original. Persist new columns.
8. Invite (Task 8 will branch on parallel/`send_email`; this task: sequential + `send_email` default true, but **mint a token for every human at send** so create can return every `sign_url`. For sequential, only the first human is emailed. Later humans: `token_hash`/`token_enc` set, `sent_at` null until `inviteNextHumanIfNeeded`. Extract `mintHumanToken(db, signerId)` used by invite.)

Simplest invite change that unblocks all `sign_url`s:

- New `mintHumanTokens(db, humans): Map<id, raw>` sets hash+enc for each human.
- `inviteFirstSigner` mints all humans, emails only the first (or first human after skipping leading agents as today), returns `{ signers: { email, role, sign_url }[] }`.
- `inviteNextHumanIfNeeded` uses the already-minted token (`openWebhookSecret(tokenEnc)`) instead of reminting. **Never remint** (same rule as reminders).

GET `/v1/documents/:id`: include `fields`, `signing_mode`, `send_email`, per-signer `role`, `values` (signature/initials become `"[signed]"` if `fieldAppearanceKey` or `appearanceKey` exists), and `sign_url` for humans when `token_enc` is present (owner GET already authorized).

`POST /v1/templates`: parse tags if a file is uploaded; accept `fields` JSON; store union. `templateJson` adds `fields`. Send copies `fields` onto the document and accepts `values` / `order` / `send_email` / `completed_redirect_url` / `embed_origin` / per-signer `role`+`values`.

- [ ] **Step 1: Write the failing tests**

In `create-document.test.ts` (copy the live-key helper already in that file):

```ts
it("parses tags, stores fields, and returns every human sign_url", async () => {
  // live key + tagged PDF from Task 2 helper
  // POST multipart title, sender_email, signers JSON two humans, file
  // expect 201, json.signers.length === 2, both sign_url
  // GET :id fields includes sig
});

it("rejects a signature field on an agent role", async () => {
  // Pro + agent + fields signature role=grok → 400 invalid_fields
});

it("rejects fields with zero humans", async () => {
  // only agent parties + a readonly text field → 400 invalid_fields
});

it("applies per-signer prefill over document values", async () => {
  // fields text Full Name on Signer 1
  // values { "Full Name": "Doc" } and signer values { "Full Name": "Jane" }
  // GET signer.values["Full Name"] === "Jane"
});
```

Templates: create from tagged PDF, GET includes fields, send copies fields onto the document.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/create-document.test.ts src/test/templates.test.ts`

Expected: new cases FAIL.

- [ ] **Step 3: Implement create/template/GET/invite mint**

Wire `commitCompletedDocument` later (Task 5). Do not change Finish yet.

- [ ] **Step 4: Run tests**

Run: `pnpm test src/test/create-document.test.ts src/test/templates.test.ts src/test/fields.test.ts src/test/tags.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/documents.ts src/routes/otp.ts src/routes/templates.ts src/lib/embed.ts src/test/create-document.test.ts src/test/templates.test.ts
git commit -m "Accept tagged fields and prefill on create and templates."
```

---

### Task 5: Ceremony Finish with fields

**Files:**
- Modify: `src/routes/signing.ts` — `getSigningState`, `postSign`, `sequentialWait`, `commitCompletedDocument`, new `getCeremonyPreview`
- Create: `app/s/[token]/preview/route.ts`
- Modify: `src/lib/storage.ts` usage for `fieldAppearanceKey`
- Test: `src/test/signing.test.ts`

**Interfaces:**
- Consumes: `burnFields` via `completeDocumentPdf`, `fieldAppearanceKey`, `openWebhookSecret`
- Produces: preview PDF; Finish with `values` + `sig:<name>` PNGs; burned complete

`GET /s/:token/preview`: same load/expiry/sequentialWait as ceremony GET. If pending and this signer may open, return **original** bytes, `content-type: application/pdf`, `content-disposition: inline`. 409/410 as today.

`getSigningState` JSON adds: `id` (document id), `fields` (this party’s fields only), `values` (this party), `signing_mode`, `completed_redirect_url`, `embed_origin`.

`sequentialWait`: if `document.signingMode === "parallel"` return null. (Parallel send lands in Task 8; the branch can exist now.)

`postSign` when this party has any fields:

1. Consent still required.
2. Parse `values` JSON (optional object). Coerce checkbox with `value === true || value === "true"`. Empty `date` → `YYYY-MM-DD` of `now()`. Empty `name` → `signer.name`.
3. Required checkbox must be true. Required text non-empty. Required signature/initials: file `sig:<fieldName>` PNG (`isPng`, max 1_000_000 as today). Exactly one signature field may also accept the existing `png` key.
4. Readonly POST that disagrees with stored `signer.values` → 400 `invalid_values`. Stored readonly wins.
5. Persist `signers.values`, put PNGs at `fieldAppearanceKey`. Also put `appearanceKey` copy of the first signature PNG so no-fields-adjacent code does not break.
6. Last party: load all parties’ pngs/values, call `completeDocumentPdf` with `fields` + `fieldParties` (and appearances for humans who lack a signature field, using `appearanceKey` PNG).
7. Not last: set `signed_at`, invite next human as today.

No-fields path: keep requiring `png` and `appendSignaturePage` complete. Do not call `burnFields`.

- [ ] **Step 1: Write the failing tests** in `src/test/signing.test.ts`

Reuse existing send+consent helpers in that file.

```ts
it("preview returns the original PDF while pending", async () => { /* GET /s/token/preview 200 */ });

it("Finish with a signature field completes without an extra page", async () => {
  // tagged or API fields signature
  // consent + POST sign with png + values {}
  // GET :id.pdf page count 1 (pdf-lib load)
});

it("required checkbox false returns 400 invalid_values", async () => { /* ... */ });

it("consent is still required when fields exist", async () => { /* 400 consent_required */ });

it("sequential wait still 409 for signer 2", async () => { /* two humans, fields on both */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/signing.test.ts`

Expected: new cases FAIL.

- [ ] **Step 3: Implement preview + Finish + complete wiring**

`commitCompletedDocument` must pass `fields` and `fieldParties` into `completeDocumentPdf`. Build `fieldParties` from signer rows + stored PNGs.

- [ ] **Step 4: Run tests**

Run: `pnpm test src/test/signing.test.ts src/test/complete-pdf.test.ts src/test/create-document.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/signing.ts app/s/[token]/preview/route.ts src/test/signing.test.ts
git commit -m "Finish on-page fields and preview the original PDF."
```

---

### Task 6: Ceremony overlay UI

**Files:**
- Modify: `app/s/[token]/signing-ceremony.tsx`
- Modify: `app/s/[token]/page.tsx` — pass new state fields
- Test: `src/test/signing-ceremony-ui.test.ts` (`// @vitest-environment happy-dom`)

**Interfaces:**
- Consumes: ceremony state `fields`, `values`, `id`, `embed_origin`, `completed_redirect_url`
- Produces: UI that fills fields and POSTs `values` + `sig:<name>` files

When `state.fields` is missing or empty: keep the current canvas + consent UI.

When fields exist:

1. Fetch `GET /s/${token}/preview`.
2. Render pages with `pdfjs-dist` (dynamic import). If pdfjs fails in tests, still render one HTML box per field (name as label) so Finish works.
3. Overlay absolutely-positioned boxes using `area.x/y/w/h` percent.
4. Signature/initials: click opens the existing canvas; save stores a PNG blob in component state keyed by field name.
5. Text: input. Date: `input type="date"` default today. Name: input default `signerName`. Checkbox: toggle. Readonly: text, not editable.
6. Consent still required. Finish disabled until consent + required fields present.
7. POST FormData: `values` JSON plus `sig:<fieldName>` files. Keep `png` if there is exactly one signature field.
8. Decline unchanged.
9. Hit area min 44px on the box.

Do not add a placer on `/send` or `/templates`.

- [ ] **Step 1: Write the failing UI test**

```ts
// @vitest-environment happy-dom
it("with fields, Finish posts values and a sig file after consent", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/preview")) {
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        headers: { "content-type": "application/pdf" },
      });
    }
    if (url.endsWith("/consent")) return Response.json({ ok: true });
    if (url.endsWith("/sign")) {
      const body = init?.body as FormData;
      expect(body.get("values")).toBeTruthy();
      return Response.json({ status: "completed", shred_at: "2026-09-01" });
    }
    return new Response("no", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(createElement(SigningCeremony, {
    token: "tok",
    consentText: "I agree",
    state: {
      title: "Repair authorization",
      signerName: "Jane",
      signerEmail: "jane@example.com",
      sequentialWait: false,
      expiresAt: "2026-09-01T00:00:00.000Z",
      id: "doc-1",
      fields: [{
        name: "sig", type: "signature", role: "Signer 1",
        required: true, readonly: false,
        areas: [{ page: 1, x: 10, y: 80, w: 40, h: 10 }],
      }],
      values: {},
    },
  }));
  // check consent, draw if canvas present or click the sig box, Finish
});
```

Also assert the no-fields path still has the canvas and “Finish” button (existing behavior).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/test/signing-ceremony-ui.test.ts`

Expected: FAIL (fields UI missing).

- [ ] **Step 3: Implement overlay / field form in `SigningCeremony`**

- [ ] **Step 4: Run tests**

Run: `pnpm test src/test/signing-ceremony-ui.test.ts src/test/signing.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/s/[token]/signing-ceremony.tsx app/s/[token]/page.tsx src/test/signing-ceremony-ui.test.ts
git commit -m "Walk on-page fields in the signing ceremony."
```

---

### Task 7: Embed

**Files:**
- Modify: `src/lib/embed.ts` — `ceremonyCsp`, `ceremonyFrameHeaders`
- Modify: `middleware.ts` — matcher `/s/:token` and `/s/:token/:path*`
- Modify: `src/routes/signing.ts` / documents create (already storing embed_origin / redirect / send_email)
- Modify: `src/routes/documents.ts` — honor `send_email` on invite
- Modify: `app/s/[token]/signing-ceremony.tsx` — `postMessage` + redirect
- Test: `src/test/embed.test.ts`, extend `src/test/create-document.test.ts`, UI test for postMessage

**Interfaces:**

```ts
export function parseEmbedOrigin(raw: string):
  | { ok: true; origin: string }
  | { ok: false; code: "embed_origin_invalid" };

export function ceremonyCsp(embedOrigin: string | null): string;
// null → "frame-ancestors 'self'"
// set  → "frame-ancestors 'self' https://app.example.com"

export function ceremonyFrameHeaders(embedOrigin: string | null): HeadersInit;
// include Content-Security-Policy
// X-Frame-Options: SAMEORIGIN only when embedOrigin is null
```

Middleware: parse token from `/s/:token`. Hash with `hashSigningToken`. Load signer + document. Set CSP headers via `ceremonyFrameHeaders(document.embedOrigin)`. If lookup fails, still set `frame-ancestors 'self'`.

`send_email=false`: `mintHumanTokens` + `sent_at` now, **do not** `mailer.sendMail` for invites. Create still returns `sign_url`s.

Ceremony client: if `window.parent !== window` and `state.embed_origin`, on completed/declined:

```ts
window.parent.postMessage(
  { source: "agentsign", event: "completed" | "declined", id: state.id, status },
  state.embed_origin,
);
```

If `completed_redirect_url`, assign `window.top.location` (framed) or `window.location` (top-level). Do not append the token.

Blocked redirect at **create** already 400. Do not skip completion mail.

- [ ] **Step 1: Write the failing tests**

```ts
it("send_email false mints URLs and does not send invite mail", async () => {
  // recorded mail has no invite to jane; 201 has sign_url
});

it("embed_origin localhost http is ok; path is not", async () => {
  expect(parseEmbedOrigin("http://localhost:3000").ok).toBe(true);
  expect(parseEmbedOrigin("https://app.example.com/path").ok).toBe(false);
});

it("ceremonyCsp includes the embed origin", () => {
  expect(ceremonyCsp("https://app.example.com")).toContain("https://app.example.com");
  expect(ceremonyCsp(null)).toBe("frame-ancestors 'self'");
});

it("completed_redirect_url to http is 400", async () => { /* create */ });
```

UI: stub `window.parent.postMessage` and `window.parent !== window`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/embed.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement CSP, send_email, postMessage, redirect**

- [ ] **Step 4: Run tests**

Run: `pnpm test src/test/embed.test.ts src/test/create-document.test.ts src/test/signing-ceremony-ui.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/embed.ts middleware.ts src/routes/documents.ts src/routes/signing.ts app/s/[token]/signing-ceremony.tsx src/test/embed.test.ts
git commit -m "Embed the ceremony with CSP, postMessage, and optional silent invite."
```

---

### Task 8: Parallel order and webhook parity

**Files:**
- Modify: `src/routes/documents.ts` — `order=parallel`
- Modify: `src/routes/signing.ts` — `sequentialWait` already null on parallel
- Modify: `src/lib/webhooks.ts` — new events + values on completed
- Modify: `src/jobs/shred.ts` — skip reminders when `send_email` is false
- Modify: `src/routes/signing.ts` — fire `document.opened` on first open; `signer.completed` on Finish/attest
- Test: `src/test/signing.test.ts`, `src/test/webhooks.test.ts`, `src/test/shred.test.ts`

**Interfaces:**

Widen envelope webhook payload (still HMAC, still no tokens):

```ts
export type DocumentWebhookPayload = {
  event:
    | "document.opened"
    | "signer.completed"
    | "document.completed"
    | "document.declined"
    | "document.expired";
  id: string;
  status: string;
  sha256?: string;
  shred_at?: string;
  signer_email?: string;
  kind?: "human" | "agent";
  values?: Array<{ role: string; name: string; type: string; value: string }>;
};
```

Rename or generalize `fireDocumentCompleted` to `fireDocumentWebhook` that POSTs `JSON.stringify(payload)` with the same HMAC. Keep `fireDocumentCompleted` as a wrapper if that avoids a huge test churn, but completed body **must** include `values` when fields exist (array as spec §11).

`document.opened`: first time `opened_at` is set (existing getSigningState). Include `signer_email`.

`signer.completed`: after human `signed` or agent `attested`. Include `kind`, `signer_email`, redacted `values`.

Parallel create: `order=parallel` stores `signing_mode`. At send, email every human (unless `send_email=false`) and `fireAgentPartyReady` for every agent. Complete when every party is `partyDone` (existing last-party check already uses `allSigners.every` other than current).

Reminders: `if (document.sendEmail === false) continue;`

- [ ] **Step 1: Write the failing tests**

```ts
it("parallel lets the second human Finish without sequential_wait", async () => {
  // two humans, order=parallel, both consent+sign; no 409 on signer 2 first
});

it("document.completed webhook includes field values and not sign_url", async () => {
  // existing HMAC test pattern in webhooks.test.ts
});

it("first open fires document.opened", async () => { /* GET signing state */ });

it("send_email false skips reminders", async () => {
  // remindDue 3 days later, recorded mail has no reminder to jane
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/signing.test.ts src/test/webhooks.test.ts src/test/shred.test.ts`

Expected: new cases FAIL.

- [ ] **Step 3: Implement parallel invite + webhooks + reminder skip**

- [ ] **Step 4: Run tests**

Run: `pnpm test src/test/signing.test.ts src/test/webhooks.test.ts src/test/shred.test.ts src/test/attest.test.ts`

Expected: PASS (existing attest webhooks still fire).

- [ ] **Step 5: Commit**

```bash
git add src/routes/documents.ts src/routes/signing.ts src/lib/webhooks.ts src/jobs/shred.ts src/test/signing.test.ts src/test/webhooks.test.ts src/test/shred.test.ts
git commit -m "Add parallel signing and field values on webhooks."
```

---

### Task 9: MCP, OpenAPI, llms.txt, docs copy

**Files:**
- Modify: `src/mcp/server.ts` — `send` / `send_template` optional args; instructions string; version `2.1.0`
- Modify: `src/openapi.ts` — version `2.1.0`; document new create fields and GET shape; ceremony preview
- Modify: `app/llms.txt/route.ts` — tagged PDF example, iframe snippet, `send_email`, no `sign` tool
- Modify: `app/docs/page.tsx` only if it duplicates API surface (keep honest, no placer)
- Modify: `docs/superpowers/issues/2026-08-21-enhancement-field-placer.md` — tags shipped, placer still parked
- Test: `src/test/mcp.test.ts` (expects `openapi.info.version === "2.0.0"` today — update to `2.1.0`)

**Interfaces:**
- Consumes: Task 4 create/template send
- Produces: MCP/OpenAPI/llms describing fields without a `sign` tool

`send` inputSchema add optional:

```ts
fields: z.string().optional(), // JSON array
values: z.string().optional(),
order: z.enum(["sequential", "parallel"]).optional(),
send_email: z.boolean().optional(),
completed_redirect_url: z.string().optional(),
embed_origin: z.string().optional(),
```

Append onto the FormData when present (`fields`, `values` as strings; `send_email` as `"true"`/`"false"`).

`send_template` body JSON already; add the same optional keys.

llms.txt add a short block:

```
Optional on POST /v1/documents: fields JSON (page 1-based, x/y/w/h percent top-left), values prefill, order=parallel, send_email=false, embed_origin, completed_redirect_url. PDF {{sig}} tags work on Free one-offs. Embed: iframe /s/:token and listen for postMessage { source: "agentsign", event }. No sign tool.
```

- [ ] **Step 1: Write the failing tests**

In `mcp.test.ts`:

```ts
expect(openapi.info.version).toBe("2.1.0");
expect(init?.version).toBe("2.1.0");
const tools = /* list tools */;
expect(tools.map(t => t.name)).not.toContain("sign");
```

Add a `send` with `fields` JSON of one signature area + `minimalPdf` (no tags) and assert create stored fields (or status tool returns them).

llms GET body includes `embed_origin` and `{{sig}}`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/test/mcp.test.ts`

Expected: FAIL on version 2.1.0.

- [ ] **Step 3: Implement OpenAPI/MCP/llms and issue note**

- [ ] **Step 4: Run full suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/openapi.ts app/llms.txt/route.ts app/docs/page.tsx docs/superpowers/issues/2026-08-21-enhancement-field-placer.md src/test/mcp.test.ts
git commit -m "Document on-page fields in OpenAPI, MCP, and llms.txt."
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| §4 data model, roles, human-required | 1, 4 |
| §5 tags | 2 |
| §6.1–6.3 create/templates/GET | 4 |
| §6.4 ceremony HTTP | 5 |
| §7 burn/complete/cert | 3, 5 |
| §8 invite/parallel/send_email | 4 (mint), 7 (silent), 8 (parallel) |
| §9 embed CSP/postMessage/redirect | 7 |
| §10 ceremony UI | 6 |
| §11 webhooks | 8 |
| §12 OpenAPI/llms/MCP | 9 |
| §13 entitlement (Free tags, Pro templates) | 4 (no new paywall) |
| Non-goals | none of the tasks add a placer, DOCX, QES, or `sign` tool |

## Maintenance

- A future placer writes `DocumentField[]` only. Do not add a second coordinate system.
- Keep `appearanceKey` for no-fields complete; `fieldAppearanceKey` for per-field PNGs.
- `pdfjs-dist` + Next: if webpack bundles the worker, it belongs in `serverExternalPackages` (Task 2).
