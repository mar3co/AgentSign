# AgentSign public site: "Two Readers" design

Date: 2026-08-22
Status: approved direction; hero comp iterated to v8 on the design canvas
Scope: the public marketing surface only

## 1. Concept

Every public page addresses the product's two readers at once. The human
column is warm, typeset, paper-like. The machine column is the literal
machine interface: real curl, real JSON, real `llms.txt` and OpenAPI
references, never decorative code screenshots. The structural law: nothing
appears in the human column without a truthful machine twin, and machine
content is always real or live. "People sign by hand. Agents sign off with
named keys." is the tagline pair that the layout itself enacts.

Positioning note that shapes copy: the market is not yet ready for "agents
signing things" as the lead story. The human column tells the safe,
universal story (send, sign, sealed file). The agent story is told loudly
only in the machine column, whose reader is self-selected (developers,
agent builders, platform integrators).

## 2. Scope

In scope:

- `app/page.tsx` (home)
- `app/upgrade/` (pricing)
- `app/login/`, `app/signup/` (chrome and framing only; form logic stays)
- `app/terms/`, `app/privacy/`
- Shared chrome: `components/site-header.tsx`, `components/site-footer.tsx`,
  `components/page-shell.tsx`
- Public-surface design tokens in `app/globals.css`

Out of scope (unchanged): the `/s/:token` signing ceremony, all logged-in
pages (`/envelopes`, `/settings`, `/team`, `/agents`, `/packets`), OAuth
consent screens, and email templates. These keep the current quiet look.
The ceremony is legally sensitive (consent, attribution, audit) and gets
its own project later if desired.

## 3. Tokens

Palette (public surface only):

| Token      | Value     | Role |
|------------|-----------|------|
| `bond`     | `#FAF9F6` | page ground; white bond paper, deliberately not cream |
| `ink`      | `#1C2733` | human-column text; blue-black ink |
| `tint`     | `#2B4C9B` | security-envelope blue; links, eyebrows, machine borders, the divider rule |
| `terminal` | `#0E1420` | machine panel ground |
| `ledger`   | `#C9D6EE` | machine panel primary text |
| `seal`     | `#8C2B2B` | wax red; at most twice per page: the primary CTA and the sealed/success moment (promotes the existing `--seal` token) |

Supporting neutrals used in the comp: `#4A5361` (human secondary text),
`#7A828E` / `#6B7280` (muted), `#E6E3DA` (hairlines on bond),
`#C9CDD4` (control borders), `#9FAEC9` (drop-zone dash),
`#22304A` (rules inside terminal), `#55688F` (terminal muted),
`#7E97D8` (terminal eyebrow/status), `#8FB0F0` / `#D8E4FA` (JSON syntax),
`#8FA5CE` (terminal emphasis line).

Implementation: expose these as CSS variables scoped to the public surface
(e.g. a `data-surface="public"` attribute set by `PageShell` variant
`public`), so the logged-in app and ceremony keep today's slate tokens.
Do not redefine the shared shadcn `:root` tokens.

The public surface is light-committed in v1: one deliberate look, no dark
variant. (The logged-in app keeps its existing `.dark` behavior.)

## 4. Typography

| Role | Face | Notes |
|------|------|-------|
| Display | IBM Plex Serif (400, 500, italic 500) | headlines, page titles, the drop-zone title, wordmark. Chosen deliberately: sibling of Plex Mono; the Plex family was designed around the human-machine relationship, which is the site's thesis |
| Body | Public Sans (400, 500, 600) | already in the stack; the US government's typeface suits an e-signature product |
| Machine | IBM Plex Mono (400, 500) | all machine-column content, eyebrows, key prefixes, timestamps |

Load via `next/font/google` with `display: swap` and real fallback stacks
(Georgia for the serif, system-ui for the sans, ui-monospace for mono).
Big Shoulders is retired from the public surface.

Type details locked in the comp:

- Hero headline ~48px/1.14, letter-spacing -0.02em, weight 500, with an
  italic beat on "AI agents" and the final full stop in `seal` red. The
  red period is the page's smallest signature; reuse it on other public
  page titles.
- Eyebrows: Plex Mono, ~11px, uppercase, letter-spacing 0.22em, `tint`
  (human side) or `#7E97D8` (terminal side).

## 5. Layout system

- Desktop: sections pair prose (left, fixed ~600px) with a machine twin
  (right, flexible), separated by a 1px `tint` rule at 25% opacity.
- Machine-side eyebrows are real addresses (`POST /v1/envelopes`,
  `GET /openapi.json`), not decorative labels.
- Mobile: human column leads; each machine twin collapses behind a
  "view as machine" disclosure per section. The page body never scrolls
  horizontally; code blocks scroll inside their own container.
- Iconography: stroke SVGs (lucide), 16px in the value band, sparing
  elsewhere. The drop zone's document icon is the only icon object in the
  hero's human column; the two links under it are plain text links.
- Motion budget: the live curl mirror (below) plus one seal-stamp beat on
  success. Nothing else. `prefers-reduced-motion` gets static states.

## 6. Signature element: the hero form and the curl are the same object

The drop zone and the machine panel's curl command are wired together on
the home page. Typing a signer name updates the `signers=[...]` line in
the curl pane character by character; choosing a PDF fills the
`-F file=@...` line; submitting from the form renders the real API
response JSON in the machine pane while the human side shows the
check-your-email state. One truth, two readers, demonstrated rather than
claimed. Everything else stays quiet so this carries the memory.

Interaction flow (preserves the existing working form logic in
`app/page.tsx`): the compact drop-zone bar expands to the full form
(title, sender email, signer name/email) once a file is chosen or
"Choose a PDF" is clicked; then send -> OTP -> key + sign URL, as today.

## 7. Voice and copy rules

- Plain English. No "attest" in prose: agents "sign off" and get a
  "cryptographic receipt". The literal API verb `attest` appears only in
  verbatim code samples and the MCP tool list. (Open product question,
  not this project: renaming the API verb itself.)
- Never the phrase "a human signs" (double-reads as the noun phrase
  "human signs").
- No em dashes. Short declarative sentences.
- Sentence case everywhere, including buttons and links.
- Legal honesty is a feature: "a cryptographic receipt, not a pretend
  signature" ships as-is in the terminal comments. No claims of court
  admissibility, SOC 2, HIPAA, or QES anywhere on the site.
- Real commands and real responses only in machine columns; sample values
  (timestamps, hashes, envelope ids) are fine but shapes must match the
  actual API.

Locked hero copy (v8 of the comp):

- Headline: "Easy signing for everything, by people and their AI agents."
- Subcopy: "Drop a PDF or POST it. Your signer gets a link, and you get
  back a sealed file with an audit trail. No account to send and none to
  sign. We shred it after 7 days unless you keep it."
- Drop zone: "Drop a PDF to send it" / "Your signer gets an email link in
  seconds" / button "Choose a PDF" (seal red).
- Links under the zone: "Connect your AI agent ->" and "Bring your team ->".
- Machine panel: eyebrow "FOR AGENTS & DEVELOPERS" + `POST /v1/envelopes`;
  the real curl; one-line response JSON; "> sent 14:02:11 UTC · Jane signs
  by email link"; comment block "# your agent can sign off too, with its
  own named key. it gets a cryptographic receipt, not a pretend signature";
  `$ sign attest env_kx3q9 --key sign_agent_procure_bot`; "> receipt
  4c19…9e2f · recorded 14:02:59 UTC"; footer "Signing inside your own
  product, not ours." + "REST + OpenAPI / MCP: send · status · attest ·
  verify / self-host: SELF_HOST=1". Replace the illustrative `$ sign
  attest` invocation with a verbatim-correct one at build time.
- Value band (icons + title + one-liner):
  1. "Always free, open source" / "Apache-2.0. Run it yourself forever,
     or use the cloud free tier."
  2. "Team plans, no per-seat pricing" / "Pro is one flat price. Invite
     your whole team. Seats aren't a thing here."
  3. "For humans and agents alike" / "People sign by hand. Agents sign
     off with named keys. Your platform integrates over REST, OpenAPI,
     or MCP."

## 8. Page-by-page

- **Home**: hero as in the comp (headline, subcopy, drop-zone bar, two
  text links | machine panel), value band. Below the fold: a
  "what happens when you send" section in the two-column pairing (the
  send -> sign -> sealed walk-through on the human side, the status/verify
  calls on the machine side), a pricing teaser, and the footer.
- **Upgrade**: Free and Pro as two prose columns using the human-side
  vocabulary; machine twin renders the same pricing as a real JSON
  document. Primary CTA in seal red on Pro only.
- **Login / Signup**: keep the working shadcn form and flows; new chrome
  and tokens; a short machine-side aside: "Agents don't log in. They hold
  keys." linking to key docs (`sign_live_`, `sign_agent_`).
- **Terms / Privacy**: typeset legal in the human voice; machine twin is a
  plain-text version link.
- **Chrome**: header (Plex Serif wordmark, Docs, Pricing, mono `/llms.txt`
  link, Log in button), footer with `/llms.txt` and `/openapi.json` as
  first-class items plus the usual legal links.

## 9. Implementation notes

- Stack stays: Next.js App Router, Tailwind v4, shadcn (base-nova on
  Base UI). New UI composes existing `components/ui/*` primitives where
  they fit; marketing-specific pieces (terminal panel, drop-zone bar,
  value band, two-column section) become components under
  `components/marketing/`.
- Public tokens live in `app/globals.css` under the
  `[data-surface="public"]` scope; shadcn semantic tokens (`--primary`,
  `--card`, ...) may be remapped inside that scope so existing primitives
  pick up the look without forking components.
- The curl mirror is client-side state shared between the form and the
  code pane on the home page; no new dependencies.
- Accessibility floor: visible keyboard focus on all interactive elements,
  the drop zone operable by keyboard and screen reader (it wraps a real
  file input), contrast at AA on both bond and terminal grounds,
  `prefers-reduced-motion` respected.
- Reference comps live on the design canvas ("AgentSign Public Site"
  artifact); the hero is v8. The Registered Mail and Audit Trail artboards
  are reference only.

## 10. Testing

- Existing route tests keep passing (`pnpm test`); the home form flow
  (send -> OTP -> key) keeps its behavior with the expanded-form
  interaction added.
- Component tests for the new marketing pieces where behavior exists (the
  curl mirror updates from form input; the machine-twin disclosure on
  mobile).
- Manual pass at 390px, 768px, 1440px; keyboard-only walk of the hero.

## 11. Decisions log

- Direction: Two Readers over Registered Mail and Audit Trail (user pick).
- Display face: IBM Plex Serif over Libre Caslon, Newsreader, Bricolage
  (user pick, "C is better").
- Band keeps icons; the links under the drop zone are text-only (user).
- Headline: "Easy signing for everything, by people and their AI agents."
  (user's opener + approved second half).
- Agent story lives in the machine column, not the human column, until
  the market is ready (user).
