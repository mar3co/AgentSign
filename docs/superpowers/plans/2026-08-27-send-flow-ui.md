# Send Flow UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `/send` to a one-page flow with a live PDF preview, opt-in click-to-place field editor, signing-order toggle, and an optional sender message in the invite email.

**Architecture:** The page stays a single client component tree under `app/send/`. New capabilities serialize into params `POST /v1/documents` already accepts (`fields` JSON, `order`, per-signer `role`); the only new backend surface is an optional `message` (param → `documents.message` column → invite email). PDF rendering reuses the dynamic `pdfjs-dist/legacy/build/pdf.mjs` import pattern from the signing ceremony.

**Tech Stack:** Next.js app router, React 19 client components, shadcn/ui primitives, zod, drizzle (hand-written SQL migrations; tests use PGlite pushSchema), vitest + happy-dom + @testing-library/react, pdfjs-dist, pdf-lib.

**Spec:** `docs/superpowers/specs/2026-08-27-send-flow-ui-design.md`

## Global Constraints

- Commit messages: plain imperative mood, **no AI attribution trailers** (no `Co-Authored-By: Claude`, no `Generated with` lines) — workspace rule.
- Message to signers: max **1000** chars after trim, stored plain text, always HTML-escaped in email HTML (escaping happens centrally in `htmlFromText`; tests must prove it).
- Field types: only the existing six (`signature, initials, date, name, text, checkbox`) from `src/lib/pdf/fields.ts:3`. No new types.
- Field areas are percent-of-page (`page` 1-based, `x/y/w/h` in 0–100); existing limits stand: max 200 fields, max 20 areas/field.
- Roles: client always sends `role: "Signer N"` (N = row position, 1-based), matching `defaultRoleName` in `src/lib/pdf/fields.ts:94`.
- Zero placed fields is valid and must keep today's behavior end to end.
- Imports from `src/` inside `app/` use the `@/src/...` alias (see `app/s/[token]/signing-ceremony.tsx:17`).
- Run tests with `pnpm test` (vitest run), filter with `pnpm vitest run <file> -t "<name>"`. Typecheck with `pnpm typecheck`.
- UI test files start with `// @vitest-environment happy-dom`.
- Existing behavior that must not regress: OTP confirm step, one-time key display, `send_email=false`, tag-parsing (`{{...}}`) on upload, agent signers via API.

---

### Task 1: Backend `message` param and column

**Files:**
- Modify: `src/db/schema.ts` (documents table, ~line 67)
- Create: `drizzle/0005_sender_message.sql`
- Modify: `src/routes/documents.ts` (`DocumentExtras` ~line 95, `parseDocumentExtras` ~line 408, both `.insert(documents)` sites ~lines 813 and 1021, `sendPreparedPdf` opts ~line 728, `createDocument` form reads ~line 903)
- Test: `src/test/create-document.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `documents.message: string | null` column; `POST /v1/documents` accepts optional form part `message` (trimmed, ≤1000 chars, else 400 `invalid_request`); `parseDocumentExtras` result gains `message: string | null`; `sendPreparedPdf` opts gain `message?: string | null`. Task 2 reads `document.message` at invite call sites.

- [ ] **Step 1: Write failing API tests**

In `src/test/create-document.test.ts`, find the existing OTP-path test that posts a document and copy its setup helper usage. Add to the main describe block:

```ts
it("stores a trimmed sender message", async () => {
  // use the same helpers the neighboring tests use to build deps + form
  const form = makeForm(); // whatever local helper builds the standard multipart body
  form.set("message", "  Please sign before Friday.  ");
  const res = await postDocument(request(form));
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  expect(row!.message).toBe("Please sign before Friday.");
});

it("rejects a message over 1000 characters", async () => {
  const form = makeForm();
  form.set("message", "x".repeat(1001));
  const res = await postDocument(request(form));
  expect(res.status).toBe(400);
  const body = (await res.json()) as { code?: string };
  expect(body.code).toBe("invalid_request");
});

it("stores null when message is blank", async () => {
  const form = makeForm();
  form.set("message", "   ");
  const res = await postDocument(request(form));
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  expect(row!.message).toBeNull();
});
```

Adapt `makeForm()`/`request()` to whatever the file actually names its helpers — read the file first; do not invent a parallel harness. Cover BOTH creation paths if the file distinguishes them (live-key path via `sendPreparedPdf` and OTP path): at minimum one assertion per path that `message` lands in the row.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/create-document.test.ts -t "message"`
Expected: FAIL (`message` not a column / stays undefined).

- [ ] **Step 3: Implement**

`src/db/schema.ts`, inside `documents` table after `senderEmail`:

```ts
  message: text("message"),
```

`drizzle/0005_sender_message.sql`:

```sql
-- Optional sender message shown in the invite email.
-- Tests use PGlite pushSchema and do not run this file.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS message text;
```

`src/routes/documents.ts` — add near `parseSendEmail`:

```ts
const MESSAGE_MAX = 1000;

function parseMessage(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; response: Response } {
  if (raw == null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") {
    return {
      ok: false,
      response: jsonError(400, "Invalid message", "invalid_request"),
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > MESSAGE_MAX) {
    return {
      ok: false,
      response: jsonError(
        400,
        `message is too long (max ${MESSAGE_MAX} characters)`,
        "invalid_request",
      ),
    };
  }
  return { ok: true, value: trimmed };
}
```

Thread it through:
- `DocumentExtras` type: add `message: string | null;`
- `parseDocumentExtras` input: add `message?: unknown;`; call `parseMessage(input.message)`, bail on `!ok`, add `message: message.value` to the returned `extras`.
- `createDocument`: add `message: form.get("message"),` to the `parseDocumentExtras({...})` call (~line 903).
- `sendPreparedPdf` opts type: add `message?: string | null;`; its `.insert(documents).values({...})` gains `message: opts.message ?? null,`.
- The live-key call site (~line 966–979): pass `message: extras.extras.message,`.
- The OTP-path insert (~line 1021): add `message: extras.extras.message,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/create-document.test.ts`
Expected: all PASS (new and pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/0005_sender_message.sql src/routes/documents.ts src/test/create-document.test.ts
git commit -m "Accept an optional sender message on document creation"
```

---

### Task 2: Invite email renders the message

**Files:**
- Modify: `src/lib/email.ts` (`inviteEmail`, line 129)
- Modify: `src/routes/documents.ts` (both `inviteEmail({...})` call sites, ~lines 627 and 691)
- Modify: `src/routes/signing.ts` (`inviteEmail({...})` call site, ~line 886 — the next-signer invite in sequential mode)
- Test: `src/test/email.test.ts`

**Interfaces:**
- Consumes: `documents.message` from Task 1 (`document.message` is available at all three call sites because each loads the document row).
- Produces: `inviteEmail` accepts optional `message?: string | null`.

- [ ] **Step 1: Write failing email tests**

In `src/test/email.test.ts` (follow its existing import/describe style):

```ts
it("renders the sender message in text and html", () => {
  const mail = inviteEmail({
    signUrl: "/s/tok123",
    senderEmail: "shop@example.com",
    title: "Repair authorization",
    expiresAt: new Date("2026-09-03T00:00:00Z"),
    message: "Please sign before Friday.",
  });
  expect(mail.text).toContain("Message from shop@example.com:");
  expect(mail.text).toContain("Please sign before Friday.");
  expect(mail.html).toContain("Please sign before Friday.");
});

it("escapes html in the sender message", () => {
  const mail = inviteEmail({
    signUrl: "/s/tok123",
    senderEmail: "shop@example.com",
    title: "T",
    expiresAt: new Date("2026-09-03T00:00:00Z"),
    message: `<script>alert("x")</script>`,
  });
  expect(mail.html).not.toContain("<script>");
  expect(mail.html).toContain("&lt;script&gt;");
});

it("omits the message block when message is absent", () => {
  const mail = inviteEmail({
    signUrl: "/s/tok123",
    senderEmail: "shop@example.com",
    title: "T",
    expiresAt: new Date("2026-09-03T00:00:00Z"),
  });
  expect(mail.text).not.toContain("Message from");
});
```

If `htmlFromText` turns out NOT to escape HTML, escaping must be added there (it is the single text→html funnel) — that is in scope for this task.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/email.test.ts -t "message"`
Expected: FAIL (unknown property `message` / missing content).

- [ ] **Step 3: Implement**

`inviteEmail` in `src/lib/email.ts`:

```ts
export function inviteEmail(input: {
  signUrl: string;
  senderEmail: string;
  title: string;
  expiresAt: Date;
  brand?: MailBrand;
  message?: string | null;
}): Pick<MailMessage, "subject" | "text" | "html"> {
  const messageLines = input.message
    ? [``, `Message from ${input.senderEmail}:`, input.message]
    : [];
  const text = [
    `${senderWho(input.senderEmail, input.brand)} asked you to sign "${input.title}".`,
    ...messageLines,
    ``,
    `Sign here: ${absoluteUrl(input.signUrl)}`,
    ``,
    `This link expires on ${input.expiresAt.toISOString()}.`,
    ``,
    `If you were not expecting this, contact the sender.`,
  ].join("\n");
  return {
    subject: `Please sign: ${input.title}`,
    text,
    html: htmlFromText(text, input.brand?.hasLogo),
  };
}
```

At each of the three call sites add one line to the `inviteEmail({...})` argument object:

```ts
            message: document.message,
```

(In `signing.ts` the loaded row variable is also named `document`; verify and use whatever it is named there.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/email.test.ts src/test/create-document.test.ts src/test/branding.test.ts`
Expected: PASS (branding.test.ts calls `inviteEmail` at line 479 — must still pass untouched).

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts src/routes/documents.ts src/routes/signing.ts src/test/email.test.ts
git commit -m "Render the sender message in signer invite emails"
```

---

### Task 3: MCP `send` tool passes `message` through

**Files:**
- Modify: `src/mcp/server.ts` (send tool, ~lines 98–170)
- Test: `src/test/mcp.test.ts`

**Interfaces:**
- Consumes: Task 1's `message` form part.
- Produces: MCP `send` input gains optional `message: string`.

- [ ] **Step 1: Write failing test**

In `src/test/mcp.test.ts`, find the existing `send` tool test and add a sibling that calls the tool with `message: "Please sign before Friday."` and asserts the created document row's `message` column equals it (the file already wires `createDocument` against a test db).

```ts
it("send passes message through to the document", async () => {
  const res = await callTool("send", {
    ...baseSendArgs, // reuse the file's existing arg builder
    message: "Please sign before Friday.",
  });
  expect(res.isError).toBeFalsy();
  const { id } = JSON.parse(textOf(res)) as { id: string };
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  expect(row!.message).toBe("Please sign before Friday.");
});
```

Adapt helper names to the file's actual conventions — read it first.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/mcp.test.ts -t "message"`
Expected: FAIL (unknown input key or null column).

- [ ] **Step 3: Implement**

In the `send` tool `inputSchema` add:

```ts
        message: z.string().max(1000).optional().describe("Message shown to signers in the invite email."),
```

In the form assembly add:

```ts
      if (args.message != null) form.set("message", args.message);
```

Append `message` to the tool description's optional-fields list and to the server `instructions` string's "Optional send fields" sentence.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/mcp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/test/mcp.test.ts
git commit -m "Pass sender message through the MCP send tool"
```

---

### Task 4: Client field model

**Files:**
- Modify: `src/lib/pdf/fields.ts` (export a required-default helper)
- Create: `app/send/field-model.ts`
- Test: `src/test/field-model.test.ts`

**Interfaces:**
- Consumes: `FieldType`, `DocumentField`, `fieldTypes` from `src/lib/pdf/fields.ts`.
- Produces (used by Tasks 7 and 8):

```ts
export type PlacedField = {
  id: string;           // client-only id
  type: FieldType;
  signerIndex: number;  // 0-based signer row index
  page: number;         // 1-based
  x: number; y: number; w: number; h: number; // percent of page
  required: boolean;
};
export const SIGNER_COLORS: readonly string[];
export function signerColor(index: number): string;
export const DEFAULT_FIELD_SIZES: Record<FieldType, { w: number; h: number }>;
export function makePlacedField(type: FieldType, signerIndex: number, page: number, x: number, y: number): PlacedField;
export function clampToPage(f: PlacedField): PlacedField;
export function serializeFields(placed: PlacedField[]): DocumentField[];
export function removeSignerFields(placed: PlacedField[], signerIndex: number): PlacedField[];
```

- [ ] **Step 1: Write failing unit tests**

Create `src/test/field-model.test.ts` (node env, like `src/test/fields.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import {
  clampToPage,
  makePlacedField,
  removeSignerFields,
  serializeFields,
  signerColor,
  SIGNER_COLORS,
} from "../../app/send/field-model.js";
import { parseFieldsJson } from "../lib/pdf/fields.js";

describe("field model", () => {
  it("places a field centered on the click with the type's default size", () => {
    const f = makePlacedField("signature", 0, 1, 50, 50);
    expect(f.page).toBe(1);
    expect(f.type).toBe("signature");
    expect(f.x + f.w / 2).toBeCloseTo(50, 5);
    expect(f.y + f.h / 2).toBeCloseTo(50, 5);
    expect(f.required).toBe(true); // signature defaults required
  });

  it("text and checkbox default to optional", () => {
    expect(makePlacedField("text", 0, 1, 10, 10).required).toBe(false);
    expect(makePlacedField("checkbox", 0, 1, 10, 10).required).toBe(false);
  });

  it("clamps placements to the page", () => {
    const f = clampToPage({ ...makePlacedField("signature", 0, 1, 0, 0), x: -10, y: 99 });
    expect(f.x).toBeGreaterThanOrEqual(0);
    expect(f.y + f.h).toBeLessThanOrEqual(100);
  });

  it("serializes to fields the server schema accepts, with Signer N roles and unique names", () => {
    const placed = [
      makePlacedField("signature", 0, 1, 30, 80),
      makePlacedField("signature", 1, 1, 70, 80),
      makePlacedField("date", 0, 2, 30, 85),
    ];
    const out = serializeFields(placed);
    expect(out).toHaveLength(3);
    expect(out[0]!.role).toBe("Signer 1");
    expect(out[1]!.role).toBe("Signer 2");
    expect(new Set(out.map((f) => f.name)).size).toBe(3);
    const parsed = parseFieldsJson(JSON.parse(JSON.stringify(out)));
    expect(parsed.ok).toBe(true);
  });

  it("drops a removed signer's fields and shifts later signer indexes down", () => {
    const placed = [
      makePlacedField("signature", 0, 1, 30, 80),
      makePlacedField("signature", 1, 1, 50, 80),
      makePlacedField("signature", 2, 1, 70, 80),
    ];
    const out = removeSignerFields(placed, 1);
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.signerIndex)).toEqual([0, 1]);
  });

  it("cycles signer colors", () => {
    expect(signerColor(0)).toBe(SIGNER_COLORS[0]);
    expect(signerColor(SIGNER_COLORS.length)).toBe(SIGNER_COLORS[0]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/field-model.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

In `src/lib/pdf/fields.ts`, export the existing private map's lookup (keep the map private):

```ts
export function defaultRequired(type: FieldType): boolean {
  return requiredByType[type];
}
```

Create `app/send/field-model.ts`:

```ts
import {
  defaultRequired,
  type DocumentField,
  type FieldType,
} from "@/src/lib/pdf/fields";

export type PlacedField = {
  id: string;
  type: FieldType;
  signerIndex: number;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
};

export const SIGNER_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
] as const;

export function signerColor(index: number): string {
  return SIGNER_COLORS[index % SIGNER_COLORS.length]!;
}

export const DEFAULT_FIELD_SIZES: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 22, h: 5 },
  initials: { w: 8, h: 5 },
  date: { w: 14, h: 3.5 },
  name: { w: 18, h: 3.5 },
  text: { w: 18, h: 3.5 },
  checkbox: { w: 3, h: 3 },
};

let nextId = 0;
function localId(): string {
  nextId += 1;
  return `pf_${nextId}`;
}

export function clampToPage(f: PlacedField): PlacedField {
  const w = Math.min(f.w, 100);
  const h = Math.min(f.h, 100);
  return {
    ...f,
    w,
    h,
    x: Math.min(Math.max(f.x, 0), 100 - w),
    y: Math.min(Math.max(f.y, 0), 100 - h),
  };
}

export function makePlacedField(
  type: FieldType,
  signerIndex: number,
  page: number,
  x: number,
  y: number,
): PlacedField {
  const size = DEFAULT_FIELD_SIZES[type];
  return clampToPage({
    id: localId(),
    type,
    signerIndex,
    page,
    x: x - size.w / 2,
    y: y - size.h / 2,
    w: size.w,
    h: size.h,
    required: defaultRequired(type),
  });
}

export function serializeFields(placed: PlacedField[]): DocumentField[] {
  const counts = new Map<string, number>();
  return placed.map((f) => {
    const n = (counts.get(f.type) ?? 0) + 1;
    counts.set(f.type, n);
    return {
      name: `${f.type}_${n}`,
      type: f.type,
      role: `Signer ${f.signerIndex + 1}`,
      required: f.required,
      readonly: false,
      areas: [{ page: f.page, x: f.x, y: f.y, w: f.w, h: f.h }],
    };
  });
}

export function removeSignerFields(
  placed: PlacedField[],
  signerIndex: number,
): PlacedField[] {
  return placed
    .filter((f) => f.signerIndex !== signerIndex)
    .map((f) =>
      f.signerIndex > signerIndex
        ? { ...f, signerIndex: f.signerIndex - 1 }
        : f,
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/field-model.test.ts src/test/fields.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/fields.ts app/send/field-model.ts src/test/field-model.test.ts
git commit -m "Add client field model for on-page placement"
```

---

### Task 5: UploadDropzone exposes the selected file

**Files:**
- Modify: `components/upload-dropzone.tsx`
- Test: `src/test/send-ui.test.ts` (a small new test; the component has no dedicated test file — do not create one just for this)

**Interfaces:**
- Produces: new optional prop `onFileChange?: (file: File | null) => void`, fired on choose, drop, remove, and form reset.

- [ ] **Step 1: Write failing test**

In `src/test/send-ui.test.ts` add (uses the real dropzone already rendered by `SendClient`):

```ts
it("notifies when a file is chosen", async () => {
  // rendered via SendClient in later tasks; at this stage test the component directly:
  const seen: (File | null)[] = [];
  render(
    createElement(UploadDropzone, {
      id: "f",
      name: "f",
      accept: "application/pdf",
      onFileChange: (f: File | null) => seen.push(f),
    }),
  );
  const input = document.querySelector("input[type=file]") as HTMLInputElement;
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", {
    type: "application/pdf",
  });
  Object.defineProperty(input, "files", { value: [file] });
  fireEvent.change(input);
  expect(seen).toEqual([file]);
});
```

Import `UploadDropzone` from `../../components/upload-dropzone.js` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/send-ui.test.ts -t "notifies"`
Expected: FAIL (prop does not exist / callback never fires).

- [ ] **Step 3: Implement**

Add `onFileChange` to the props type and thread it through `readInput`, the remove button handler, and the form-reset effect:

```ts
  onFileChange?: (file: File | null) => void;
```

```ts
  const readInput = () => {
    const f = inputRef.current?.files?.[0] ?? null;
    setFile(f ? { name: f.name, size: f.size } : null);
    onFileChange?.(f);
  };
```

In the reset effect's `onReset`, also call `onFileChange?.(null)`; same in the remove-file handler (whatever clears the input — find it in the component body).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/send-ui.test.ts`
Expected: PASS (all pre-existing tests too).

- [ ] **Step 5: Commit**

```bash
git add components/upload-dropzone.tsx src/test/send-ui.test.ts
git commit -m "Expose the selected file from the upload dropzone"
```

---

### Task 6: PDF preview component

**Files:**
- Create: `app/send/pdf-preview.tsx`
- Test: `src/test/pdf-preview-ui.test.ts`

**Interfaces:**
- Consumes: a `File` from Task 5.
- Produces (used by Tasks 7–9):

```tsx
export type PreviewPage = { dataUrl: string; aspect: number }; // aspect = height/width
export function PdfPreview(props: {
  file: File;
  overlay?: (pageIndex: number) => React.ReactNode; // absolutely-positioned layer per page
  onPagesRendered?: (pageCount: number) => void;
}): React.ReactElement;
```

Each page renders as `<div data-page={i+1} className="relative"><img …/>{overlay?.(i)}</div>` so overlays position with percent coordinates against the page box.

- [ ] **Step 1: Write failing component test**

Create `src/test/pdf-preview-ui.test.ts`:

```ts
// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
      scale,
    }),
    render: () => ({ promise: Promise.resolve() }),
  };
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => page,
      }),
    }),
  };
});

import { PdfPreview } from "../../app/send/pdf-preview.js";

function pdfFile() {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", {
    type: "application/pdf",
  });
}

describe("PdfPreview", () => {
  afterEach(() => cleanup());

  it("renders one image per page with page markers", async () => {
    render(createElement(PdfPreview, { file: pdfFile() }));
    await waitFor(() =>
      expect(document.querySelectorAll("[data-page]").length).toBe(2),
    );
    expect(document.querySelector('[data-page="1"] img')).toBeTruthy();
  });

  it("shows a notice when rendering fails, without throwing", async () => {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
    vi.spyOn(mod, "getDocument").mockImplementationOnce(() => {
      throw new Error("bad pdf");
    });
    render(createElement(PdfPreview, { file: pdfFile() }));
    await screen.findByText(/preview unavailable/i);
  });
});
```

Note: happy-dom canvases have no real 2d context; the component must tolerate `canvas.getContext("2d")` returning null (skip drawing, still emit the page div with an empty-src img). Mirror how `signing-ceremony.tsx` renders pages (~its `pageImages` effect) but keep this component self-contained.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/pdf-preview-ui.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `app/send/pdf-preview.tsx` — client component. Shape:

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";

export type PreviewPage = { dataUrl: string; aspect: number };

export function PdfPreview({
  file,
  overlay,
  onPagesRendered,
}: {
  file: File;
  overlay?: (pageIndex: number) => ReactNode;
  onPagesRendered?: (pageCount: number) => void;
}) {
  const [pages, setPages] = useState<PreviewPage[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPages(null);
    setFailed(false);
    (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        const out: PreviewPage[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
          }
          out.push({
            dataUrl: ctx ? canvas.toDataURL("image/png") : "",
            aspect: viewport.height / viewport.width,
          });
          if (cancelled) return;
        }
        if (!cancelled) {
          setPages(out);
          onPagesRendered?.(out.length);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, onPagesRendered]);

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        Preview unavailable. You can still send this PDF.
      </p>
    );
  }
  if (!pages) {
    return <p className="text-sm text-muted-foreground">Rendering preview…</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {pages.map((p, i) => (
        <div
          key={i}
          data-page={i + 1}
          className="relative w-full overflow-hidden rounded-md border bg-white"
          style={{ aspectRatio: `1 / ${p.aspect}` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.dataUrl} alt={`Page ${i + 1}`} className="w-full" draggable={false} />
          {overlay?.(i)}
        </div>
      ))}
    </div>
  );
}
```

Check whether the ceremony sets `GlobalWorkerOptions.workerSrc` before `getDocument`; replicate exactly what it does so the worker loads the same way in the browser.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/pdf-preview-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/send/pdf-preview.tsx src/test/pdf-preview-ui.test.ts
git commit -m "Render a client-side PDF preview on the send page"
```

---

### Task 7: Field editor (palette + overlay)

**Files:**
- Create: `app/send/field-editor/palette.tsx`
- Create: `app/send/field-editor/overlay.tsx`
- Test: `src/test/field-editor-ui.test.ts`

**Interfaces:**
- Consumes: `PlacedField`, `makePlacedField`, `clampToPage`, `signerColor` from Task 4.
- Produces:

```tsx
// palette.tsx
export function FieldPalette(props: {
  signers: { name: string; email: string }[];
  activeSigner: number;
  onSignerChange: (index: number) => void;
  activeType: FieldType | null;          // null = placement off
  onTypeChange: (type: FieldType | null) => void;
}): React.ReactElement;

// overlay.tsx — rendered inside PdfPreview's overlay slot for one page
export function FieldOverlay(props: {
  pageIndex: number;                      // 0-based
  fields: PlacedField[];                  // all placed fields (it filters to its page)
  tagFields?: DocumentField[];            // read-only, Task 9
  placing: { signerIndex: number; type: FieldType } | null;
  onPlace: (f: PlacedField) => void;
  onChange: (f: PlacedField) => void;     // move/resize (already clamped)
  onDelete: (id: string) => void;
}): React.ReactElement;
```

Interaction contract: with `placing` set, a click on empty page space calls `onPlace(makePlacedField(type, signerIndex, pageIndex + 1, xPct, yPct))` where `xPct/yPct` derive from the click position relative to the page div's bounding rect. Each placed field renders as an absolutely positioned div (`left/top/width/height` in `%`), tinted `signerColor(signerIndex)` at low opacity with a solid border, a type label, a delete button (`aria-label="Delete field"`), and a bottom-right resize handle. Drag moves via pointer events on the field div; resize via pointer events on the handle; both call `onChange(clampToPage(next))`. For `text`/`checkbox` fields only, a small required/optional toggle button cycles `required`.

- [ ] **Step 1: Write failing component tests**

Create `src/test/field-editor-ui.test.ts`:

```ts
// @vitest-environment happy-dom
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FieldOverlay } from "../../app/send/field-editor/overlay.js";
import { FieldPalette } from "../../app/send/field-editor/palette.js";
import {
  makePlacedField,
  type PlacedField,
} from "../../app/send/field-model.js";

function Harness({ placing }: { placing: boolean }) {
  const [fields, setFields] = useState<PlacedField[]>([]);
  return createElement(
    "div",
    { style: { position: "relative", width: "600px", height: "800px" } },
    createElement(FieldOverlay, {
      pageIndex: 0,
      fields,
      placing: placing ? { signerIndex: 0, type: "signature" as const } : null,
      onPlace: (f: PlacedField) => setFields((p) => [...p, f]),
      onChange: (f: PlacedField) =>
        setFields((p) => p.map((x) => (x.id === f.id ? f : x))),
      onDelete: (id: string) => setFields((p) => p.filter((x) => x.id !== id)),
    }),
  );
}

describe("field editor", () => {
  afterEach(() => cleanup());

  it("palette lists the six types and the signers", () => {
    render(
      createElement(FieldPalette, {
        signers: [{ name: "Jane", email: "jane@example.com" }],
        activeSigner: 0,
        onSignerChange: () => {},
        activeType: null,
        onTypeChange: () => {},
      }),
    );
    for (const label of [/signature/i, /initials/i, /date/i, /name/i, /text/i, /checkbox/i]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByText(/jane/i)).toBeTruthy();
  });

  it("click places a field when placement is armed", () => {
    render(createElement(Harness, { placing: true }));
    fireEvent.click(screen.getByTestId("field-layer"), {
      clientX: 300,
      clientY: 400,
    });
    expect(screen.getByText(/signature/i)).toBeTruthy();
  });

  it("click does nothing when placement is off", () => {
    render(createElement(Harness, { placing: false }));
    fireEvent.click(screen.getByTestId("field-layer"), {
      clientX: 300,
      clientY: 400,
    });
    expect(screen.queryByText(/signature/i)).toBeNull();
  });

  it("delete removes the field", () => {
    render(createElement(Harness, { placing: true }));
    fireEvent.click(screen.getByTestId("field-layer"), { clientX: 300, clientY: 400 });
    fireEvent.click(screen.getByRole("button", { name: /delete field/i }));
    expect(screen.queryByText(/signature/i)).toBeNull();
  });
});
```

The overlay's click target is a full-page absolutely-positioned div with `data-testid="field-layer"`. happy-dom gives `getBoundingClientRect()` zeros — the overlay must guard division by zero (fall back to placing at 0,0 when rect width/height are 0), which the placement test tolerates.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/field-editor-ui.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement palette and overlay**

Follow the interface contract above. Implementation notes (not optional):
- Both files start with `"use client";`.
- Palette signer chips: button per signer showing a colored dot (`signerColor(i)`) and the signer's name or `Signer ${i+1}` when the name is blank; `aria-pressed` for the active one. Type buttons likewise `aria-pressed`; clicking the active type again calls `onTypeChange(null)` (disarm).
- Overlay root:

```tsx
<div
  data-testid="field-layer"
  className="absolute inset-0"
  style={{ cursor: placing ? "crosshair" : undefined }}
  onClick={handlePlaceClick}
>
```

- `handlePlaceClick` ignores clicks that bubbled from an existing field (`e.target !== e.currentTarget` guard), computes percents from `getBoundingClientRect()` with the zero-guard, and calls `onPlace`.
- Field divs: `style={{ left: f.x + "%", top: f.y + "%", width: f.w + "%", height: f.h + "%", borderColor: color, background: color + "1a" }}`, `onPointerDown` starts a move (record start pointer + field, `setPointerCapture`, `onPointerMove` converts pixel delta to percent via the layer rect, `onChange(clampToPage(...))`, `onPointerUp` ends). Resize handle is an 8px square bottom-right with its own `onPointerDown` that adjusts `w/h` instead, minimum 2% each.
- Tag fields (`tagFields` prop): render the same boxes in neutral gray, dashed border, label `${type} · from tags`, no handlers.
- Keep each file under ~200 lines; shared pointer math may live in a small `app/send/field-editor/pointer.ts` if needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/field-editor-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/send/field-editor src/test/field-editor-ui.test.ts
git commit -m "Add click-to-place field editor palette and overlay"
```

---

### Task 8: Send page integration

**Files:**
- Modify: `app/send/send-client.tsx` (becomes the state machine: form → OTP → done; the form body moves out)
- Create: `app/send/send-form.tsx`
- Test: `src/test/send-ui.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–7; `POST /v1/documents` params `fields`, `order`, `message`, signer `role` (all pre-existing server-side).
- Produces: `SendForm` renders the whole form; `send-client.tsx` keeps `SendClient` exported with unchanged external behavior (route `app/send/page.tsx` untouched).

Layout: while no file is selected, the current single card. Once a file is selected, wrap in `div.grid.gap-6.lg:grid-cols-[minmax(0,1fr)_420px]` — left column `FieldPalette` + `PdfPreview` (overlay slot renders `FieldOverlay` per page), right column the existing form fields plus the new controls, in a card that is `lg:sticky lg:top-6 self-start`.

New controls in the form:
- **Signing order** radio group (only shown when `signers.length > 1`): "In order listed" (default) / "All at once". When "All at once", submit sets `data.set("order", "parallel")`; otherwise no `order` key. Replaces the static "They sign in the order listed." caption with the group; caption stays when only one signer.
- **Message to signers**: `<Textarea id="message" name="message" maxLength={1000} />` (shadcn `components/ui/textarea` — check it exists; if not, add it via the project's established shadcn pattern) with `Label "Message to signers (optional)"` and a live `{message.length}/1000` counter.
- Signer removal: when a signer with placed fields is removed, call `removeSignerFields` and show `window.confirm("Removing this signer also removes their N placed fields.")` first; skip confirm when they own none.

Submit wiring in `onSubmit` (after the existing `data.set("signers", ...)`):

```ts
    data.set(
      "signers",
      JSON.stringify(
        signers.map((s, i) => ({
          name: s.name.trim(),
          email: s.email.trim(),
          role: `Signer ${i + 1}`,
        })),
      ),
    );
    if (placed.length > 0) {
      data.set("fields", JSON.stringify(serializeFields(placed)));
    }
    if (order === "parallel") data.set("order", "parallel");
```

Confirm-step summary: `SendClient` passes a summary object `{ title, signerCount, order, fieldCount, hasMessage, pageCount }` into the OTP card, rendered as one muted line, e.g. `Repair authorization · 3 pages · 2 signers, in order · 4 fields · message included`. With zero placed fields the fields item reads `no placed fields — signers review and sign`.

- [ ] **Step 1: Write failing UI tests**

Add to `src/test/send-ui.test.ts` (mock `PdfPreview` to avoid pdfjs: `vi.mock("../../app/send/pdf-preview.js", ...)` returning a stub that renders its overlay for 1 page):

```ts
it("posts order=parallel when All at once is chosen", async () => {
  // arrange: whoami ok, select a file via the dropzone, add a second signer,
  // choose "All at once", fill and submit; capture fetch body.
  const bodies: FormData[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (String(url).includes("whoami")) return Promise.resolve(whoamiOk());
    bodies.push(init!.body as FormData);
    return Promise.resolve(
      new Response(JSON.stringify({ id: "d1" }), { status: 201 }),
    );
  });
  render(createElement(SendClient));
  await selectPdf(); // helper: fires change on the file input as in Task 5's test
  fireEvent.click(screen.getByRole("button", { name: /add signer/i }));
  fireEvent.click(screen.getByRole("radio", { name: /all at once/i }));
  await fillAndSubmitTwoSigners();
  expect(bodies[0]!.get("order")).toBe("parallel");
});

it("omits order and fields by default and includes roles on signers", async () => {
  /* same arrangement, defaults; assert: */
  expect(bodies[0]!.get("order")).toBeNull();
  expect(bodies[0]!.get("fields")).toBeNull();
  const signers = JSON.parse(String(bodies[0]!.get("signers")));
  expect(signers[0].role).toBe("Signer 1");
});

it("sends the message field when filled", async () => {
  /* fill textarea "Message to signers" with "Please sign." and submit; assert: */
  expect(bodies[0]!.get("message")).toBe("Please sign.");
});

it("serializes placed fields into the fields param", async () => {
  /* with the PdfPreview stub rendering the overlay, arm signature placement
     via the palette, click the field layer, submit; assert: */
  const fields = JSON.parse(String(bodies[0]!.get("fields")));
  expect(fields).toHaveLength(1);
  expect(fields[0].type).toBe("signature");
  expect(fields[0].role).toBe("Signer 1");
});

it("shows a summary line on the confirm step", async () => {
  /* after submit resolves with { id: "d1" }: */
  expect(await screen.findByText(/1 signer/i)).toBeTruthy();
});
```

Flesh the arrangement helpers out fully in the test file (real code, shared between tests); keep every pre-existing test in the file passing — they pin the OTP and done states.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/send-ui.test.ts`
Expected: new tests FAIL (no radio, no textarea, no fields wiring).

- [ ] **Step 3: Implement**

Move the form JSX out of `send-client.tsx` into `send-form.tsx` with the layout and wiring above. `send-client.tsx` keeps: whoami effect, `onSubmit`/`onConfirm` fetch logic, `done`/`documentId` branches, and now also holds `signers`, `placed`, `order`, `message`, `file` state (single source of truth), passing state + setters into `SendForm`. Follow existing shadcn component usage (`RadioGroup` from `components/ui/radio-group` if present, else two labeled `<input type="radio">`s styled like the codebase's other radios — check first).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run src/test/send-ui.test.ts && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/send components/ui src/test/send-ui.test.ts
git commit -m "Integrate preview, field placement, order, and message on the send page"
```

---

### Task 9: Read-only tag preview overlay

**Files:**
- Modify: `app/send/send-client.tsx` (or `send-form.tsx`, wherever `file` state lives after Task 8)
- Test: `src/test/send-ui.test.ts`

**Interfaces:**
- Consumes: `parsePdfTags(bytes)` from `@/src/lib/pdf/tags` (returns `{ fields, pdf }`, throws `InvalidFieldsError` on bad tags); `FieldOverlay`'s `tagFields` prop from Task 7.
- Produces: `tagFields: DocumentField[]` state threaded into each page's `FieldOverlay`.

**Spec guard:** `parsePdfTags` statically imports only `pdf-lib` and dynamically imports `pdfjs-dist/legacy/build/pdf.mjs` (`src/lib/pdf/tags.ts:343`), both browser-capable — but this has never run in a browser. If it fails at runtime for environmental reasons, the catch below already makes the feature invisible; in that case note it in the PR and move on. Placement (Task 7/8) must not depend on this task.

- [ ] **Step 1: Write failing test**

In `src/test/send-ui.test.ts`, mock the tags module:

```ts
vi.mock("../../src/lib/pdf/tags.js", () => ({
  parsePdfTags: async () => ({
    fields: [
      {
        name: "sig",
        type: "signature",
        role: "Signer 1",
        required: true,
        readonly: false,
        areas: [{ page: 1, x: 10, y: 80, w: 20, h: 5 }],
      },
    ],
    pdf: new Uint8Array(),
  }),
}));
```

```ts
it("overlays tag-detected fields read-only after choosing a file", async () => {
  render(createElement(SendClient));
  await selectPdf();
  expect(await screen.findByText(/from tags/i)).toBeTruthy();
  // read-only: no delete button on tag boxes
  expect(screen.queryByRole("button", { name: /delete field/i })).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/send-ui.test.ts -t "tags"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Where `file` state is set, add an effect:

```ts
  useEffect(() => {
    if (!file) {
      setTagFields([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { parsePdfTags } = await import("@/src/lib/pdf/tags");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = await parsePdfTags(bytes);
        if (!cancelled) setTagFields(parsed.fields);
      } catch {
        if (!cancelled) setTagFields([]); // tags preview is best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);
```

Pass `tagFields` into each `FieldOverlay` (filtering per page happens inside the overlay, matching how it filters `fields`).

- [ ] **Step 4: Run tests + typecheck, then a real-browser smoke check**

Run: `pnpm vitest run src/test/send-ui.test.ts && pnpm typecheck`
Expected: PASS.
Then start `pnpm dev`, open `/send`, choose a PDF containing a `{{sig;role=Signer 1}}` tag (create one with pdf-lib in a scratch script under `$CLAUDE_JOB_DIR/tmp` if none is handy), and confirm the dashed overlay appears with no console errors. If the browser import fails environmentally, record exactly what failed in the commit body and leave the catch-guarded code in.

- [ ] **Step 5: Commit**

```bash
git add app/send src/test/send-ui.test.ts
git commit -m "Overlay tag-detected fields read-only on the send preview"
```

---

### Task 10: Full verification

**Files:** none new.

- [ ] **Step 1: Full test suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: everything passes. Fix anything broken before proceeding — especially `create-document.test.ts`, `send-ui.test.ts`, `branding.test.ts`, `mcp.test.ts`, `templates.test.ts`.

- [ ] **Step 2: Manual pass against the spec's checklist**

With `pnpm dev`:
1. Zero-field send (no tags, nothing placed): sender OTP → signer link → ceremony still shows the consent-and-finish flow.
2. Placed-fields send: two signers, place signature+date for each, send, open signer 1's link — fields render at the placed positions.
3. "All at once": both signers get links immediately (check the response `signers` array).
4. Message: fill it, confirm the invite email text via the dev mailer/logs contains the message.
5. Remove a signer who owns fields: confirm dialog, fields disappear, remaining fields reassigned correctly (colors shift).

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "Fix issues found in send flow verification"
```

(Skip if nothing changed.)
