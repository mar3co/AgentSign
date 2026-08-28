# Markdown send — design

2026-08-28

## Goal

Let agents submit document content as **markdown** instead of uploading a PDF. AgentSign renders it server-side into a fixed, clean "legal paper" PDF, and everything downstream — tag parsing, field burning, hashing, sealing, certificate, shredder, verify — runs unchanged. This removes the file-handling burden for MCP clients: an agent writes plain text, no PDF generation, no base64.

Markdown is an **optional input alongside PDF**. The PDF path is untouched and stays fully supported.

## Non-goals

- Replacing or deprecating PDF upload.
- Images in markdown (they reopen the upload problem; alt text renders as a placeholder).
- Per-sender styling, theming, or branding of rendered pages (fixed house style in v1).
- Markdown-authored templates (`/v1/templates`, `send_template`) — natural follow-up, not v1.
- HTML input, Chromium/headless rendering, or any second PDF stack.

## Architecture

One new module: the renderer. It converts markdown to PDF bytes that enter the existing intake exactly where an uploaded file would.

```
markdown ──renderMarkdown()──▶ PDF bytes ──▶ parsePdfAndFields (existing) ──▶ store/tags/burn/seal (existing)
```

### Renderer — `src/lib/pdf/renderMarkdown.ts`

- **Parser:** `marked` (lexer only — we consume tokens, never its HTML output). Zero-dependency, forgiving, battle-tested.
- **Typesetter:** pdf-lib with StandardFonts, same stack as `certificate.ts` / `appendSignaturePage.ts`. No new rendering dependency.
- **Never rejects.** Agents may submit anything. Unsupported or malformed constructs degrade to plain text; raw HTML renders as literal text; images render as `[image: alt]`; links render as `text (url)`. The only input errors are empty content and the size cap.
- **Supported constructs:** headings h1–h6 (scaled sizes), paragraphs, bold / italic / bold-italic, inline code and fenced code blocks (Courier), ordered and unordered lists with nesting, blockquotes, horizontal rules, tables (simple full-width grid, wrapped cells), hard line breaks.
- **Layout:** US Letter, 1" margins, Times body ~11pt, Helvetica headings, `Page n of m` footer. The document `title` param stays metadata (email subject, dashboard) as it does for uploads; it is not injected into the page — the markdown carries its own headings.
- **Pagination:** simple line-based cursor; blocks flow across page breaks.
- **Signature tags:** `{{sig}}` / `{{date}}` / `{{text:role=…}}` etc. are emitted as literal text, and the produced PDF flows through the existing `parsePdfAndFields` → `tags.ts` pipeline, which locates and white-outs them exactly as in uploaded PDFs. No new field syntax. *Contingency:* if tag extraction from our own content streams proves unreliable, the renderer returns field areas directly (it knows where it drew each tag) in the same `DocumentField` shape — an internal detail, same interface downstream.
- **Limits:** `MARKDOWN_MAX_BYTES = 1 MiB` (constant next to `PDF_MAX_BYTES`), rendered page cap (200 pages) as an abuse bound → `markdown_too_large`.

## API changes

### REST — `POST /v1/documents`

- New optional string form field `markdown`. Exactly one of `file` | `markdown` is required:
  - neither → existing 400 (message updated: "A PDF file or markdown is required")
  - both → 400 `invalid_request`
  - empty/whitespace markdown → 400 `invalid_markdown`
  - over cap / page cap → 400 `markdown_too_large`
- After rendering, the request proceeds through the current code path (tags, extras, OTP vs live key, storage) with no other changes.

### MCP — `send` tool

- `pdf` becomes optional; new optional `markdown: z.string()`. Exactly one required (schema-level refinement plus a clear error).
- Tool description leads with markdown: "Prefer `markdown` — plain text, no file handling. `{{sig}}` tags place fields. Or pass base64 `pdf` bytes for an existing document."
- Server-level description and `llms.txt` updated the same way.

### Docs

`openapi.json`, `llms.txt`, MCP descriptions, README example gain the markdown variant (e.g. `-F markdown='# NDA … {{sig}}'`). PDF examples remain.

## Storage — "store both"

- New file kind `"source"` added to `fileKind` (`src/db/schema.ts`). The column is app-level `text` with a TS enum, so **no DB migration**.
- On markdown sends, the source bytes are stored at `objectKey(documentId, "source")` with a `files` row (own sha256). PDF sends store nothing extra.
- **Shredder:** `"source"` joins the `KINDS` purge loop in `src/jobs/shred.ts`, so shred/void deletes it with the PDFs. No new retention logic.
- **Retrieval:** `GET /v1/documents/:id/pdf?kind=source` (existing endpoint, existing auth) returns `text/markdown` as `{id}.md`. Unlike `sealed`/`certificate`, `source` is available before completion — the sender already has it; the gate exists only because sealed output doesn't exist yet.
- The canonical legal artifact remains the rendered/sealed PDF and its hash chain; the source is provenance ("what did the agent submit"), not a signed object. Certificate unchanged.

## Signing ceremony

Unchanged. Signers see the rendered PDF; Finish/Attest, consent, and audit flows don't know the document started as markdown.

## Error handling

- Input problems (empty, too large, page cap) → 400 with the codes above.
- An internal renderer crash on accepted input is our bug → 500 `render_failed`, logged. Never silently send a mangled document.

## Testing

- **Renderer unit tests (bulk of the work):** one case per construct; degradation cases (raw HTML, images, deep nesting, pathological input); pagination across page breaks; deterministic output for identical input.
- **Tag round-trip:** markdown containing `{{sig}}` → rendered PDF → `parsePdfAndFields` finds the field and whites out the tag.
- **Route tests (PGlite):** markdown happy path end-to-end; both/neither/empty/oversize errors; `files` row with kind `source` created; `?kind=source` download; shred purges the source blob.
- **MCP:** `send` with `markdown`, and the one-of validation.

## Rollout

Additive, no flags, no migration. Self-host gets it for free.
