# Two Readers Public Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the public marketing surface (home, upgrade, login/signup, terms/privacy, shared chrome) as the approved "Two Readers" design without touching the signing ceremony or logged-in app.

**Architecture:** A `data-surface="public"` scope in `app/globals.css` remaps the shadcn semantic tokens and heading font for public pages only; new marketing components (`TerminalPanel`, `TwoReader`, `ValueBand`) compose with existing `components/ui/*`; the home page rewires its existing working send/OTP flow into the new hero where the form and the curl pane mirror each other.

**Tech Stack:** Next.js 15 App Router, Tailwind v4, shadcn (base-nova on Base UI), next/font/google, Vitest + happy-dom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-22-marketing-two-readers-design.md` (read it first; it carries palette, voice rules, and locked copy).

## Global Constraints

- Palette (exact): bond `#FAF9F6`, ink `#1C2733`, tint `#2B4C9B`, terminal `#0E1420`, ledger `#C9D6EE`, seal `#8C2B2B`.
- Fonts: display IBM Plex Serif (400, 500, italic 500) public surface only; body Public Sans; mono IBM Plex Mono. Big Shoulders stays loaded for the app surface.
- Voice: no em dashes anywhere in new copy; never the phrase "a human signs"; "attest" only inside verbatim code samples and the MCP tool list; sentence case everywhere.
- Copy is LOCKED where quoted in a task. Do not improve it.
- Seal red appears at most twice per page: primary CTA and sealed/success moments.
- Do not modify: `/app/s/**`, `/app/envelopes/**`, `/app/settings/**`, `/app/team/**`, `/app/agents/**`, `/app/packets/**`, `/app/internal/**`, anything under `/app/v1/**`, `src/**` (except adding tests in `src/test/`).
- All commands run with pnpm. Test invocation pattern: `pnpm vitest run src/test/<file>.test.ts`.
- Commit after every task with the trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01HqfRwxiASGb3zZ1Riv7pEh`

---

### Task 1: Public-surface tokens and fonts

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Modify: `components/page-shell.tsx`
- Test: `src/test/public-surface-ui.test.ts` (create)

**Interfaces:**
- Produces: CSS utility classes `bg-bond`, `text-ink`, `text-tint`, `bg-terminal`, `text-ledger`, `bg-seal`, `text-seal`, `border-tint` (via `@theme inline` color mappings); CSS variable `--font-serif-face`; `PageShell` renders `data-surface="public"` on its root div for variants `public` and `auth`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `src/test/public-surface-ui.test.ts`:

```ts
// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PageShell } from "../../components/page-shell.js";

describe("PageShell public surface", () => {
  afterEach(() => cleanup());

  it("marks public variant with data-surface", () => {
    const { container } = render(
      createElement(PageShell, { variant: "public", children: "hi" }),
    );
    expect(container.querySelector('[data-surface="public"]')).toBeTruthy();
  });

  it("marks auth variant with data-surface", () => {
    const { container } = render(
      createElement(PageShell, { variant: "auth", children: "hi" }),
    );
    expect(container.querySelector('[data-surface="public"]')).toBeTruthy();
  });

  it("does not mark app or ceremony variants", () => {
    for (const variant of ["app", "ceremony"] as const) {
      const { container } = render(
        createElement(PageShell, { variant, children: "hi" }),
      );
      expect(container.querySelector("[data-surface]")).toBeNull();
      cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/public-surface-ui.test.ts`
Expected: FAIL (no element with `data-surface`).

- [ ] **Step 3: Implement**

In `app/layout.tsx`, add the serif alongside the existing fonts (keep Big Shoulders):

```tsx
import { Big_Shoulders, IBM_Plex_Mono, IBM_Plex_Serif, Public_Sans } from "next/font/google";

const serif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif-face",
});
```

Add `serif.variable` to the `<html>` className list. Also update the metadata description (the old one uses a banned phrase):

```ts
const description =
  "Easy signing for everything, by people and their AI agents.";
```

In `app/globals.css`:

1. Inside the existing `@theme inline` block add:

```css
    --color-bond: var(--bond);
    --color-ink: var(--ink);
    --color-tint: var(--tint);
    --color-terminal: var(--terminal);
    --color-ledger: var(--ledger);
    --font-serif: var(--font-serif-face), Georgia, serif;
```

and change the existing seal mapping to `--color-seal: var(--seal);`.

2. Inside `:root` add the palette and repoint seal:

```css
    --bond: #faf9f6;
    --ink: #1c2733;
    --tint: #2b4c9b;
    --terminal: #0e1420;
    --ledger: #c9d6ee;
    --seal: #8c2b2b;
```

(The existing `--seal: oklch(0.48 0.14 25);` line is replaced by the hex.)

3. After the `.dark` block add the public-surface scope:

```css
[data-surface="public"] {
    --background: var(--bond);
    --foreground: var(--ink);
    --card: #ffffff;
    --card-foreground: var(--ink);
    --border: #e6e3da;
    --input: #c9cdd4;
    --primary: var(--tint);
    --primary-foreground: var(--bond);
    --ring: var(--tint);
    --muted: #f1efe9;
    --muted-foreground: #6b7280;
    --secondary: #f1efe9;
    --secondary-foreground: var(--ink);
    --accent: #f1efe9;
    --accent-foreground: var(--ink);
}
```

4. In the `@layer base` block add a scoped heading font rule after the existing `.font-heading` rule:

```css
  [data-surface="public"] :is(.font-heading, h1, h2, h3) {
    font-family: var(--font-serif-face), Georgia, serif;
    font-weight: 500;
  }
```

In `components/page-shell.tsx`, set the attribute on the root div:

```tsx
    <div
      data-surface={variant === "public" || variant === "auth" ? "public" : undefined}
      className={cn("mx-auto flex min-h-dvh w-full min-w-0 flex-col", WIDTH[width])}
    >
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/test/public-surface-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: clean. (Other UI tests render PageShell; the new attribute must not break them.)

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx app/globals.css components/page-shell.tsx src/test/public-surface-ui.test.ts
git commit -m "feat: public-surface tokens, Plex Serif, data-surface scope"
```

---

### Task 2: Marketing components (TerminalPanel, TwoReader, ValueBand)

**Files:**
- Create: `components/marketing/terminal-panel.tsx`
- Create: `components/marketing/two-reader.tsx`
- Create: `components/marketing/value-band.tsx`
- Test: `src/test/marketing-ui.test.ts` (create)

**Interfaces:**
- Consumes: color utilities from Task 1 (`bg-terminal`, `text-ledger`, `text-tint`, `bg-seal`).
- Produces (exact signatures later tasks rely on):

```tsx
// terminal-panel.tsx
export function TerminalPanel(props: {
  eyebrow: string;            // e.g. "For agents & developers"
  address?: string;           // e.g. "POST /v1/envelopes"
  footer?: ReactNode;         // rendered under a hairline at the bottom
  className?: string;
  children: ReactNode;
}): JSX.Element;

// two-reader.tsx
export function TwoReader(props: {
  human: ReactNode;
  machine: ReactNode;
  machineLabel?: string;      // default "View as machine"
  className?: string;
}): JSX.Element;

// value-band.tsx  (no props)
export function ValueBand(): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

Create `src/test/marketing-ui.test.ts`:

```ts
// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TerminalPanel } from "../../components/marketing/terminal-panel.js";
import { TwoReader } from "../../components/marketing/two-reader.js";
import { ValueBand } from "../../components/marketing/value-band.js";

afterEach(() => cleanup());

describe("TerminalPanel", () => {
  it("renders eyebrow, address, children, footer", () => {
    render(
      createElement(TerminalPanel, {
        eyebrow: "For agents & developers",
        address: "POST /v1/envelopes",
        footer: createElement("span", null, "footer-line"),
        children: createElement("code", null, "curl"),
      }),
    );
    expect(screen.getByText("For agents & developers")).toBeTruthy();
    expect(screen.getByText("POST /v1/envelopes")).toBeTruthy();
    expect(screen.getByText("curl")).toBeTruthy();
    expect(screen.getByText("footer-line")).toBeTruthy();
  });
});

describe("TwoReader", () => {
  it("renders both columns and a mobile disclosure", () => {
    render(
      createElement(TwoReader, {
        human: createElement("p", null, "human side"),
        machine: createElement("p", null, "machine side"),
      }),
    );
    expect(screen.getByText("human side")).toBeTruthy();
    expect(screen.getAllByText("machine side").length).toBeGreaterThan(0);
    expect(screen.getByText("View as machine")).toBeTruthy();
  });
});

describe("ValueBand", () => {
  it("renders the three locked value props", () => {
    render(createElement(ValueBand));
    expect(screen.getByText("Always free, open source")).toBeTruthy();
    expect(screen.getByText("Team plans, no per-seat pricing")).toBeTruthy();
    expect(screen.getByText("For humans and agents alike")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/test/marketing-ui.test.ts`
Expected: FAIL (modules do not exist).

- [ ] **Step 3: Implement the three components**

`components/marketing/terminal-panel.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TerminalPanel({
  eyebrow,
  address,
  footer,
  className,
  children,
}: {
  eyebrow: string;
  address?: string;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-lg bg-terminal p-6 font-mono text-[13px] leading-relaxed text-ledger",
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#7e97d8]">
          {eyebrow}
        </p>
        {address ? (
          <p className="text-[11.5px] text-[#55688f]">{address}</p>
        ) : null}
      </div>
      {children}
      {footer ? (
        <div className="mt-auto flex flex-col gap-2">
          <div className="h-px bg-[#22304a]" />
          {footer}
        </div>
      ) : null}
    </div>
  );
}
```

`components/marketing/two-reader.tsx`:

```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TwoReader({
  human,
  machine,
  machineLabel = "View as machine",
  className,
}: {
  human: ReactNode;
  machine: ReactNode;
  machineLabel?: string;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "grid min-w-0 items-stretch gap-8 lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,26rem)]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-5">{human}</div>
      <div className="hidden w-px bg-tint/25 lg:block" />
      <details className="min-w-0 lg:hidden">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.2em] text-tint">
          {machineLabel}
        </summary>
        <div className="mt-3">{machine}</div>
      </details>
      <div className="hidden min-w-0 lg:flex lg:flex-col">{machine}</div>
    </section>
  );
}
```

`components/marketing/value-band.tsx` (copy is LOCKED):

```tsx
import { PenTool, Share2, Users } from "lucide-react";

const ITEMS = [
  {
    icon: Share2,
    title: "Always free, open source",
    body: "Apache-2.0. Run it yourself forever, or use the cloud free tier.",
  },
  {
    icon: Users,
    title: "Team plans, no per-seat pricing",
    body: "Pro is one flat price. Invite your whole team. Seats aren't a thing here.",
  },
  {
    icon: PenTool,
    title: "For humans and agents alike",
    body: "People sign by hand. Agents sign off with named keys. Your platform integrates over REST, OpenAPI, or MCP.",
  },
] as const;

export function ValueBand() {
  return (
    <div className="grid gap-6 border-t border-border pt-5 sm:grid-cols-3">
      {ITEMS.map((item) => (
        <div key={item.title} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <item.icon aria-hidden className="size-4 text-tint" />
            <p className="text-[15px] font-semibold">{item.title}</p>
          </div>
          <p className="pl-[26px] text-[13px] leading-relaxed text-muted-foreground">
            {item.body}
          </p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/test/marketing-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/marketing src/test/marketing-ui.test.ts
git commit -m "feat: TerminalPanel, TwoReader, ValueBand marketing components"
```

---

### Task 3: Home hero with live curl mirror

**Files:**
- Modify: `app/page.tsx` (full rewrite of layout; PRESERVE the existing submit and OTP handlers and endpoints exactly)
- Test: `src/test/home-hero-ui.test.ts` (create)

**Interfaces:**
- Consumes: `TerminalPanel`, `TwoReader`, `ValueBand` from Task 2; `PageShell` (`variant="public"`, use `width="xl"`); shadcn `Button`, `Input`, `Label`, `Alert`, `Card`.
- Produces: nothing consumed later; this is the flagship page.

Behavior requirements:

1. The existing flow is unchanged in substance: multipart POST to `/v1/envelopes` with `title`, `sender_email`, `signers` JSON, `file`; then OTP POST to `/v1/envelopes/{id}/otp`; then show the one-time key and sign URL. Copy the `onSubmit`, `onOtp`, `values` logic from the current file.
2. New: the form fields live in controlled state (`title`, `senderEmail`, `signerName`, `signerEmail`, `fileName`) so the curl pane mirrors them as you type.
3. The hero starts compact (drop-zone bar). Clicking "Choose a PDF" or dropping/selecting a file expands the full form (title, sender email, signer name, signer email, send button). Track with `const [expanded, setExpanded] = useState(false)`.
4. Machine pane content by stage: before send it shows the mirrored curl plus the static agent block; after send it appends the real response id line; the agent block is always present.

Locked hero copy (from the spec; the headline lives in an `h1` with `font-heading`):

- Eyebrow: `For humans`
- Headline: `Easy signing for everything, by people and their AI agents.` with `<em>AI agents</em>` and the final period wrapped in `<span className="text-seal">.</span>`
- Subcopy: `Drop a PDF or POST it. Your signer gets a link, and you get back a sealed file with an audit trail. No account to send and none to sign. We shred it after 7 days unless you keep it.`
- Drop zone title: `Drop a PDF to send it`; sub: `Your signer gets an email link in seconds`; button: `Choose a PDF` (className includes `bg-seal text-bond hover:bg-seal/90`)
- Links row: `Connect your AI agent →` (href `/llms.txt`) and `Bring your team →` (href `/upgrade`)
- Machine eyebrow: `For agents & developers`, address `POST /v1/envelopes`
- Agent block (verbatim, including the real REST endpoint):

```text
# your agent can sign off too, with its own
# named key. it gets a cryptographic
# receipt, not a pretend signature
$ curl -X POST \
    https://agentsign.co/v1/envelopes/env_kx3q9/attest \
    -H 'authorization: Bearer sign_agent_...'
> receipt 4c19…9e2f · recorded 14:02:59 UTC
```

- Terminal footer line 1: `Signing inside your own product, not ours.`
- Terminal footer line 2 (single row, muted): `REST + OpenAPI` · `MCP: send · status · attest · verify` · `self-host: SELF_HOST=1`

The mirrored curl builder (exact function to include):

```tsx
function curlFor(v: {
  title: string;
  senderEmail: string;
  signerName: string;
  signerEmail: string;
  fileName: string | null;
}) {
  const esc = (s: string) => s.replace(/'/g, "'\\''");
  return [
    `$ curl -F title='${esc(v.title || "Repair authorization")}' \\`,
    `       -F sender_email=${v.senderEmail || "you@example.com"} \\`,
    `       -F signers='[{"name":"${esc(v.signerName || "Jane")}",`,
    `         "email":"${v.signerEmail || "jane@example.com"}"}]' \\`,
    `       -F file=@${v.fileName || "form.pdf"} \\`,
    `       https://agentsign.co/v1/envelopes`,
  ].join("\n");
}
```

Render it in a `<pre className="overflow-x-auto whitespace-pre text-ledger">`.

Below the hero `TwoReader`, render `<ValueBand />`, then a second `TwoReader` section, "What happens when you send" (copy LOCKED):

- Human side, three short blocks each with a mono eyebrow:
  - `SENT` / `We email your signer a link. No login, no app, no account.`
  - `SIGNED` / `They review the PDF, consent, and sign by hand on any device.`
  - `SEALED` / `You both get the sealed file, a completion certificate, and the audit trail.`
- Machine side, one `TerminalPanel` with eyebrow `Status & verify`, address `GET /v1/envelopes/{id}`, body (verbatim):

```text
$ curl https://agentsign.co/v1/envelopes/env_kx3q9
{ "status": "completed", "sealed": true }

$ curl -F file=@sealed.pdf \
       https://agentsign.co/v1/verify
{ "valid": true, "certificate": "…" }
```

- [ ] **Step 1: Write the failing test**

Create `src/test/home-hero-ui.test.ts`:

```ts
// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Home from "../../app/page.js";

afterEach(() => cleanup());

describe("home hero", () => {
  it("renders the locked headline", () => {
    render(createElement(Home));
    expect(
      screen.getByRole("heading", { level: 1 }).textContent,
    ).toContain("Easy signing for everything");
  });

  it("mirrors the signer name into the curl pane", () => {
    render(createElement(Home));
    fireEvent.click(screen.getByText("Choose a PDF"));
    const name = screen.getByLabelText("Signer name");
    fireEvent.change(name, { target: { value: "Ada" } });
    const pane = document.querySelector("pre");
    expect(pane?.textContent).toContain('"name":"Ada"');
  });

  it("never says a human signs", () => {
    const { container } = render(createElement(Home));
    expect(container.textContent?.toLowerCase()).not.toContain("a human signs");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/test/home-hero-ui.test.ts`
Expected: FAIL (old headline).

- [ ] **Step 3: Rewrite `app/page.tsx`**

Full structure (keep `"use client"`; keep existing imports that still apply):

```tsx
<PageShell variant="public" width="xl">
  <TwoReader
    human={/* eyebrow, h1, subcopy, drop zone / expanded form, links row, alerts, OTP card per stage */}
    machine={
      <TerminalPanel eyebrow="For agents & developers" address="POST /v1/envelopes" footer={...}>
        <pre ...>{curlFor(state)}</pre>
        {envelopeId ? <p className="text-[#7e97d8]">&gt; sent · id {envelopeId}</p> : null}
        <div className="h-px bg-[#22304a]" />
        <pre ...>{AGENT_BLOCK}</pre>
      </TerminalPanel>
    }
  />
  <ValueBand />
  <TwoReader human={/* SENT/SIGNED/SEALED blocks */} machine={/* Status & verify panel */} />
</PageShell>
```

Implementation details that are easy to get wrong:

- The drop-zone `label` wraps the hidden file input (keep the current `PdfField` drag/drop logic; move file name into the shared state via an `onFile(name: string | null)` callback and call `setExpanded(true)` when a file lands).
- "Choose a PDF" is a `<button type="button">` that clicks the hidden input via ref AND sets `expanded` true.
- Form inputs get `value` + `onChange` wired to the state variables; `values()` reads from state, not FormData, but the FormData construction for the POST body stays (append the file from the input ref).
- Keep the sent/OTP/done stages exactly as today (Alert with one-time key, OTP card). Place them in the human column.
- The links row goes under the drop zone: two `<a>` elements, `text-sm font-medium text-tint`, arrow as `&rarr;`.
- All eyebrows: `font-mono text-[11px] uppercase tracking-[0.22em] text-tint`.
- The h1: `font-heading text-4xl leading-[1.14] tracking-[-0.02em] md:text-5xl` (font-heading resolves to Plex Serif inside the public scope from Task 1).

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/test/home-hero-ui.test.ts && pnpm vitest run src/test/marketing-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: clean. If an existing test asserts the old homepage copy, update that assertion to the new locked copy (this is the only permitted reason to touch an existing test).

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx src/test/home-hero-ui.test.ts
git commit -m "feat: Two Readers home hero with live curl mirror"
```

---

### Task 4: Public chrome (header and footer)

**Files:**
- Modify: `components/site-header.tsx`
- Modify: `components/site-footer.tsx`
- Test: extend `src/test/public-surface-ui.test.ts`

**Interfaces:**
- Consumes: token utilities from Task 1.
- Produces: header/footer used by every PageShell page; do not change the `SiteHeaderVariant` type or the app/ceremony branches.

Requirements:

- Public variant nav becomes: `Pricing` (href `/upgrade`), mono `/llms.txt` link (`font-mono text-xs text-tint`), and a `Log in` link styled as a bordered button (`rounded-md border border-input px-4 py-2 text-sm`).
- Wordmark: keep the `font-heading` class (Task 1 makes it Plex Serif on public pages automatically; app pages keep Big Shoulders). Do not add fonts here.
- Footer: keep all five links; add the OpenAPI and llms.txt links first in order; add a tagline line `Easy signing for everything.` under the wordmark in `text-xs text-muted-foreground`.
- Auth variant link text stays `Send a PDF` (that phrase is fine; the banned phrase is "a human signs").

- [ ] **Step 1: Add failing assertions** to `src/test/public-surface-ui.test.ts`:

```ts
import { SiteHeader } from "../../components/site-header.js";
import { SiteFooter } from "../../components/site-footer.js";
import { screen } from "@testing-library/react";

describe("public chrome", () => {
  afterEach(() => cleanup());

  it("public header shows Pricing, llms.txt, and Log in", () => {
    render(createElement(SiteHeader, { variant: "public" }));
    expect(screen.getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/upgrade");
    expect(screen.getByRole("link", { name: "/llms.txt" }).getAttribute("href")).toBe("/llms.txt");
    expect(screen.getByRole("link", { name: "Log in" })).toBeTruthy();
  });

  it("footer carries the tagline", () => {
    render(createElement(SiteFooter));
    expect(screen.getByText("Easy signing for everything.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**, **Step 3: implement**, **Step 4: run to verify pass** (`pnpm vitest run src/test/public-surface-ui.test.ts`), **Step 5: full suite** (`pnpm test` — the branding-ui test renders SiteHeader; keep its expectations intact), then:

- [ ] **Step 6: Commit**

```bash
git add components/site-header.tsx components/site-footer.tsx src/test/public-surface-ui.test.ts
git commit -m "feat: public chrome for Two Readers"
```

---

### Task 5: Upgrade page with pricing JSON twin

**Files:**
- Modify: `app/upgrade/page.tsx` (layout/copy only; do not touch `app/upgrade/checkout/**`)
- Test: `src/test/upgrade-ui.test.ts` (create)

**Interfaces:**
- Consumes: `TwoReader`, `TerminalPanel` from Task 2.
- Produces: nothing.

Requirements:

- Keep `PageShell variant="public"`, switch `width` to `"xl"`.
- Human side: page eyebrow `One flat price`, h1 `Keep the file a year` with seal-red final period, then the existing Free and Pro cards (keep current bullet copy and the checkout button/link exactly as they are; only reorder/restyle within the new grid). Pro card's CTA is the page's single seal-red element.
- Machine side: `TerminalPanel` with eyebrow `Pricing as data`, address `GET /llms.txt`, body verbatim:

```text
{
  "free": {
    "price_usd": 0,
    "keep_days": 7,
    "sends_per_30d": 20
  },
  "pro": {
    "price_usd_month": 19,
    "keep_days": 365,
    "named_agents": 10,
    "seats": "unlimited, flat"
  }
}
```

and footer line: `No seats. No per-document fees. Cancel any time.`

- [ ] **Step 1: failing test** `src/test/upgrade-ui.test.ts`:

```ts
// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import UpgradePage from "../../app/upgrade/page.js";

afterEach(() => cleanup());

describe("upgrade page", () => {
  it("shows the pricing JSON twin", () => {
    render(createElement(UpgradePage));
    expect(screen.getByText("Pricing as data")).toBeTruthy();
    expect(document.body.textContent).toContain('"price_usd_month": 19');
  });
});
```

- [ ] **Step 2: run (FAIL)** → **Step 3: implement** → **Step 4: run (PASS)** with `pnpm vitest run src/test/upgrade-ui.test.ts` → **Step 5: `pnpm typecheck && pnpm test`** →

- [ ] **Step 6: Commit**

```bash
git add app/upgrade/page.tsx src/test/upgrade-ui.test.ts
git commit -m "feat: upgrade page pricing twin"
```

---

### Task 6: Login page machine aside

**Files:**
- Modify: `app/login/page.tsx` (framing only; do NOT modify `app/login/login-form.tsx` logic, `app/login/session/**`, `google/**`, `github/**`)
- Test: `src/test/login-aside-ui.test.ts` (create)

Requirements: under the existing login card add a quiet aside:

```tsx
<aside className="flex flex-col gap-1 rounded-md border border-border bg-muted/50 p-4">
  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-tint">
    For agents &amp; developers
  </p>
  <p className="text-sm text-muted-foreground">
    Agents don&apos;t log in. They hold keys. Send with a throwaway
    sign_tmp_ key, or mint live keys after you log in.
  </p>
</aside>
```

- [ ] **Step 1: failing test** `src/test/login-aside-ui.test.ts` (render the page component if it is a plain sync component; if `app/login/page.tsx` is async or reads searchParams, render the extracted aside instead: move the aside into `app/login/agent-aside.tsx` exporting `AgentAside()` and test that):

```ts
// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AgentAside } from "../../app/login/agent-aside.js";

afterEach(() => cleanup());

it("explains that agents hold keys", () => {
  render(createElement(AgentAside));
  expect(screen.getByText(/Agents don't log in\. They hold keys\./)).toBeTruthy();
});
```

- [ ] **Step 2: run (FAIL)** → **Step 3: create `app/login/agent-aside.tsx` with the aside above and render `<AgentAside />` from `app/login/page.tsx` below the form** → **Step 4: run (PASS)** `pnpm vitest run src/test/login-aside-ui.test.ts` → **Step 5: `pnpm typecheck && pnpm test`** →

- [ ] **Step 6: Commit**

```bash
git add app/login/agent-aside.tsx app/login/page.tsx src/test/login-aside-ui.test.ts
git commit -m "feat: login agent aside"
```

---

### Task 7: Terms and privacy plain-text twins

**Files:**
- Create: `app/terms.txt/route.ts`
- Create: `app/privacy.txt/route.ts`
- Modify: `app/terms/page.tsx`, `app/privacy/page.tsx` (add the twin link; keep all legal copy verbatim)
- Test: `src/test/legal-txt.test.ts` (create)

Requirements:

- Each route handler returns the page's legal copy as `text/plain; charset=utf-8` with a 200. Extract the copy into a shared module so page and route render the same words: create `app/terms/terms-copy.ts` exporting `export const TERMS_SECTIONS: { heading: string; body: string }[]` populated from the CURRENT page content verbatim (same for privacy: `app/privacy/privacy-copy.ts`, `PRIVACY_SECTIONS`). The pages map over the sections; the routes join them:

```ts
import { TERMS_SECTIONS } from "../terms/terms-copy.js";

export function GET() {
  const text = TERMS_SECTIONS.map((s) => `# ${s.heading}\n\n${s.body}`).join("\n\n");
  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
```

- On each page, under the h1, add:
  `<a className="font-mono text-xs text-tint" href="/terms.txt">plain text version</a>` (respectively `/privacy.txt`).

- [ ] **Step 1: failing test** `src/test/legal-txt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GET as termsTxt } from "../../app/terms.txt/route.js";
import { GET as privacyTxt } from "../../app/privacy.txt/route.js";

describe("plain-text legal twins", () => {
  it("terms.txt serves text/plain with content", async () => {
    const res = termsTxt();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect((await res.text()).length).toBeGreaterThan(100);
  });
  it("privacy.txt serves text/plain with content", async () => {
    const res = privacyTxt();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect((await res.text()).length).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 2: run (FAIL)** → **Step 3: implement (extract copy modules, wire pages and routes)** → **Step 4: run (PASS)** `pnpm vitest run src/test/legal-txt.test.ts` → **Step 5: `pnpm typecheck && pnpm test`** →

- [ ] **Step 6: Commit**

```bash
git add app/terms.txt app/privacy.txt app/terms app/privacy src/test/legal-txt.test.ts
git commit -m "feat: plain-text twins for terms and privacy"
```

---

### Task 8: Voice sweep and final gate

**Files:**
- Modify: only files touched by Tasks 1-7 if violations are found.

- [ ] **Step 1: Sweep for banned copy** across the public surface:

Run:
```bash
grep -rn "a human signs" app components --include='*.tsx' --include='*.ts' | grep -v node_modules
grep -rn "—" app/page.tsx app/upgrade/page.tsx app/login components/site-header.tsx components/site-footer.tsx components/marketing
```
Expected: no matches (fix any found; em dashes inside `/app/s/**` or app pages are out of scope).

- [ ] **Step 2: Full gate**

Run: `pnpm typecheck && pnpm test`
Expected: clean.

- [ ] **Step 3: Commit any sweep fixes**

```bash
git add -A && git commit -m "chore: voice sweep for public surface"
```

(Skip the commit if the sweep found nothing.)
