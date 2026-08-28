# Send flow UI: preview, on-page field placement, and message — design

Date: 2026-08-27
Status: Approved (chat), pending implementation plan

## Goal

Close the UI gaps against the HelloSign-style send wizard (select documents,
add signers, place fields, review and send) while staying simpler than a
wizard: `/send` remains one page, every new capability is progressive
disclosure on that page, and the zero-effort path (upload, add signers, send)
stays exactly as fast as today.

Almost everything the UI gains is already accepted by `POST /v1/documents`
(`order`, `fields`, per-signer `role`). The only new backend surface is an
optional sender message rendered in the invite email.

## Non-goals (this round)

- Template picker inside `/send` (templates stay on `/templates`)
- CC / viewer roles, per-signer authentication
- Custom email subject, per-send expiration, manual reminders
- Multi-file upload or merge; non-PDF conversion
- New field types (dropdown, radio, attachment) — the six existing types only
- A step-based wizard of any kind

## 1. Page layout

`/send` is a single page in two states:

- **Before upload:** today's single card with the `UploadDropzone`
  (`components/upload-dropzone.tsx`). Unchanged.
- **After a PDF is selected:** the page expands to two columns.
  - Left: scrollable PDF preview, all pages, rendered client-side with
    `pdfjs-dist` (already a dependency; the signing ceremony uses the same
    legacy build via dynamic import).
  - Right: the form — title, sender email, signers, options, send button.
  - Narrow screens: preview stacks above the form.

There is no stepper and no separate review screen. The on-page preview is the
review step.

## 2. Signers

- Keep the existing repeatable name/email rows with add/remove
  (`app/send/send-client.tsx`).
- Each signer row gets a colored dot; the same color tints that signer's
  placed fields in the preview. Colors come from a fixed palette keyed by row
  index.
- New control — **Signing order** toggle:
  - "In order listed" (default) → omit `order` (backend defaults to
    `sequential`).
  - "All at once" → send `order=parallel`.
  - Wired to the existing `parseSigningMode` param (`src/routes/documents.ts:259`,
    read from `form.get("order")`).
- Role names stay invisible in the UI. The client assigns `role: "Signer N"`
  per row (matching the backend's `defaultRoleName` convention in
  `src/lib/pdf/fields.ts`) so placed fields can reference their signer. The
  existing `signerSchema` already accepts `role` (`src/routes/documents.ts:68`).

## 3. Field placement (opt-in)

- A compact palette above the preview with the six existing types from
  `FIELD_TYPES` (`src/lib/pdf/fields.ts:3`): signature, initials, date, name,
  text, checkbox.
- Interaction: select a signer chip → select a field type → click on a page to
  drop a field at a per-type default size. Placed fields can be dragged,
  resized via corner handle, and deleted. Fields render tinted with the
  owner's color plus a small type label.
- Data model: fields are held in client state as the same percent-of-page
  rects the backend validates (`fields.ts` area schema: `page`, `x`, `y`,
  `w`, `h` as percentages, clamped to the page). Existing backend limits
  apply unchanged: max 200 fields, max 20 areas per field. On submit they
  serialize to the `fields` JSON form part `POST /v1/documents` already
  parses (`parsePdfAndFields`, `src/routes/documents.ts:321`). Required flags
  use the existing per-type defaults; the editor exposes a required/optional
  toggle per placed field for text and checkbox only.
- **Tag preview:** if the PDF contains `{{tag}}` fields, run the existing
  `parsePdfTags` (`src/lib/pdf/tags.ts`) in the browser and overlay the
  detected fields read-only, labeled as coming from tags, so tag users get
  visual confirmation. Tag fields are not editable in the UI (the server
  re-parses tags authoritatively at POST time and merges via `mergeFields`).
  If `parsePdfTags` proves node-bound in practice, tag preview is dropped
  from this round without affecting placement — placement has no dependency
  on it.
- **Zero fields stays first-class:** placing no fields (and having no tags)
  is not an error. The ceremony's existing no-fields branch
  (`app/s/[token]/signing-ceremony.tsx:130` `hasFields`) already gives
  signers a consent-and-finish flow. No auto-appended signature block is
  added; the current behavior is the default.
- Duplicate-role and role-mismatch validation stays server-side
  (`prepareParties`); the client prevents the cases it can (fields always
  reference an existing signer row; removing a signer removes their fields
  after a confirm).

## 4. Message to signers

The one new backend feature.

- UI: optional "Message to signers" textarea in the form.
- API: new optional `message` form part on `POST /v1/documents` only; the
  template-send path is unchanged this round. Trimmed, max 1000 chars,
  stored as plain text. Validation errors use the existing error envelope.
- DB: nullable `message` text column on `documents`
  (`src/db/schema.ts`) with a drizzle migration.
- Email: `inviteEmail` (`src/lib/email.ts:146`) renders the message
  HTML-escaped in a quoted block under the existing intro line, and in the
  plain-text part. Subject stays hardcoded. Reminder and other emails are
  unchanged this round.
- MCP: the `send` tool (`src/mcp/server.ts`) gets the same optional
  `message` input, passed through.
- The message is sender-authored content in email: it is always escaped,
  rendered as text (no links made clickable), and capped, to keep the
  spam/abuse surface minimal.

## 4b. File replacement and whiteout patches

Two correction affordances on the send page, both pre-send only:

- **Replace the file:** removing the chosen PDF and dropping a new one keeps
  everything else — signers, message, order, and placed fields (percent
  coordinates transfer). If the new PDF has fewer pages than some fields
  reference, those fields are dropped after a confirm dialog. Detected tag
  overlays re-parse from the new file.
- **Whiteout patch tool:** a sender-side "Whiteout" tool in the palette.
  The sender drags a rectangle over content to cover it with white and may
  type replacement text (Helvetica, adjustable size — the UI notes it will
  not match the document's font). Patches render live in the preview
  overlay. At submit, patches are burned into the PDF client-side with
  pdf-lib (white rectangle + text via the existing percent→PDF-rect math),
  and the patched bytes are what upload. The server, seal, hash, and audit
  trail see only the final document; no backend changes.

Post-send correction ("correct and resend": void + reopen `/send`
pre-filled) is explicitly a follow-up round, not this one.

## 5. Send confirmation

The existing post-submit card (OTP step for logged-out/free senders, "Sent."
card otherwise) gains one compact summary line: document title, page count,
N signers and order ("2 signers, in order"), field count ("5 fields" or
"no placed fields — signers review and sign"), and whether a message is
included. No separate review screen.

## 6. Code shape

- `app/send/send-client.tsx` splits into:
  - `app/send/send-form.tsx` — form state, signers, options, submit/OTP flow
  - `app/send/pdf-preview.tsx` — pdf.js page rendering, shared by the editor
  - `app/send/field-editor/` — palette, placement overlay, drag/resize logic
- Backend diff confined to the message path: `src/routes/documents.ts`,
  `src/db/schema.ts` + migration, `src/lib/email.ts`, `src/mcp/server.ts`.
- No changes to the signing ceremony, burn-in, sealing, shred, or webhooks.

## 7. Error handling

- Preview render failure (corrupt-but-valid-magic PDF, pdf.js error): show a
  non-blocking notice in the preview pane; the form still submits (the server
  remains the authority via `isPdf` and its own parsing).
- Field references to a removed signer: removing a signer row with placed
  fields prompts confirmation and deletes those fields.
- Server-side field validation errors (off-page, over limits) surface in the
  existing form error area; the client's clamping makes them unlikely.
- `message` over 1000 chars: client-side counter plus server 400.

## 8. Testing

- Vitest unit tests: field state → `fields` JSON serialization (percent
  clamping, role wiring, per-type required defaults); `message` validation
  (trim, cap, escaping) and `inviteEmail` output with/without message.
- Component tests for the field editor: place, move, resize, delete, signer
  color assignment, signer-removal cascade.
- Existing API tests extended: `POST /v1/documents` with `message`, with
  `order=parallel` from the form path.
- Manual pass: send with tags-only PDF (overlay shows), fields-only, mixed,
  and zero-field documents; OTP path and logged-in path.
