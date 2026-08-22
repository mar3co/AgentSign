# Home scroll story design

**Status:** approved on the "AgentSign Public Site" design canvas (artboards: Hero v8 + Scroll 1-3), 2026-08-22.
**Extends:** `2026-08-22-marketing-two-readers-design.md`. All voice rules, tokens, and layout rules there still bind.

## What this is

The home page below the hero becomes a three-chapter scroll story. The hero (v8, shipped) is unchanged. As the visitor scrolls:

1. The **send affordance condenses into a sticky bar** under the header: document icon + serif "Drop a PDF to send it" + seal "Choose a PDF" button on the left; a quiet mono developer pointer on the right: `send from code:` `POST /v1/envelopes` · `OpenAPI` (link to /openapi.json). No dark chip in the bar; the pinned terminal is the only terminal on screen. Agents don't scroll pages; their door is /llms.txt in the header, so the bar's machine side addresses developers.
2. **Three chapters** scroll past a **pinned terminal** (right column). Each chapter fills roughly a viewport; scroll-snap is `proximity`, never `mandatory`. The terminal content crossfades per chapter and is always a real call.
3. The **value band rides pinned at the bottom** through the hero and every chapter showing its three titles; in the last chapter it expands to show the one-liners and the footer row (serif AgentSign + tagline, mono links) and settles as the page footer. The page ends by relaxing; nothing new arrives.

Layout is locked: human/prose column left (600px fixed at xl), agent/dev terminal column right.

## Chapter copy (verbatim, binding)

Chapter eyebrows are the visitor's own skeptical questions (mono, uppercase); headlines answer them (serif 34px-class). Ledger rows: 14px stroke icon in tint + mono label + one sentence, sentence indented under the label.

### Chapter 1
- Eyebrow: `So what is this?`
- Headline: `Accounts are optional`
- Lede: `You drop a PDF. Your signer taps a link. An account is never the price of a signature; make one only when you want a place to keep what you've signed. The file comes back sealed, with proof of everything that happened.`
- Rows (icons: Send, PenLine, Award — Award in seal red with its red label):
  - `SENT` — `We email your signer a link. They never need an account. Neither did you.`
  - `SIGNED` — `They review the PDF, consent, and sign by hand on any device.`
  - `SEALED` (seal red) — `You both get the sealed file, the certificate, and the full audit trail. We shred our copy in seven days unless you keep it.`
- Terminal: eyebrow `Status`, address `GET /v1/envelopes/{id}`; the real status curl + response; comment line `> completed 14:09:41 UTC · kept 7 days unless you keep it`.

### Chapter 2
- Eyebrow: `What do agents have to do with it?`
- Headline: `It speaks agent and developer`
- Lede: `Every month, more of your paperwork is handled by something that isn't a person. AgentSign is built for that turn, and the audit trail names everyone who took it.`
- Rows (icons: User, Bot, Code):
  - `PEOPLE` — `Sign by hand, like always. The pen stays yours.`
  - `AGENTS` — `Hold a named key and sign off with a cryptographic receipt, never a faked signature.`
  - `DEVELOPERS` — `Get the whole rail: REST, OpenAPI, MCP tools, and webhooks.`
- Links: `Read llms.txt →` (/llms.txt) · `MCP tools →` (/docs)
- Terminal: eyebrow `Your agent's turn`, address `POST /v1/envelopes/{id}/attest`; comment `# its own named key. its own receipt.`; the real attest curl; `> receipt 4c19…9e2f · recorded 14:02:59 UTC`.

### Chapter 3
- Eyebrow: `Why believe any of it?`
- Headline: `The file is the proof` + seal-red period.
- Lede: `Every sealed PDF carries its own evidence. Post it back any time; anyone can run the check, no key and no account.`
- Rows (icons: Award, PenLine, Receipt):
  - `THE SEAL` — `The file is byte for byte the one that was signed. Any edit breaks it.`
  - `THE SIGNATURES` — `Who signed, when they signed, and the consent they gave.`
  - `THE RECEIPTS` — `Which named agents signed off, and when.`
- Closing line: `The code is open, so you can run the whole service yourself.`
- Links: `See pricing →` (/upgrade) · `Read the docs →` (/docs)
- Terminal: eyebrow `Verify`, address `POST /v1/verify`; the real verify curl + response; comment `> anyone can run this. no key.`

## Behavior rules

- **Snap:** `scroll-snap-type: y proximity` on the root scroller, only while the story is on the page and only under `prefers-reduced-motion: no-preference`.
- **Pinning:** header sticky at top (public surface); send bar sticky beneath it; terminal sticky in the right column through the chapters; band sticky at the viewport bottom through hero and chapters.
- **Reduced motion:** nothing pins or snaps; chapters stack normally, each with its own machine block (the existing `View as machine` disclosure pattern); the band renders expanded at the end.
- **Mobile (< lg):** same stacked fallback as reduced motion. No horizontal overflow.
- **One terminal on screen, ever.** The bar never contains a terminal chip.
- **Seal-red budget** (≤2 per viewport state) holds: bar button + SEALED unit (ch1); bar button + headline period (ch3).
- The sticky bar's "Choose a PDF" is a **secondary** (outline) button: it returns the visitor to the hero and opens the file picker; dropping a PDF on the bar's label feeds the hero form the same way. The bar never carries the page's primary emphasis.
- **Each chapter carries its own seal-red primary CTA** (the only primary on screen in that state): chapter 1 `Choose a PDF` (the send action), chapter 2 `Connect your AI agent` (/llms.txt) with `MCP tools →` as the text link, chapter 3 `See pricing` (/upgrade) with `Read the docs →` as the text link. The seal-red budget per viewport stays ≤2: chapter CTA + SEALED unit (ch1) or headline period (ch3).
- Sections replaced by the chapters: the static value band under the hero, the old "What happens when you send" section, and the home pricing teaser (pricing keeps living on /upgrade; the band's Pro line keeps the promise in words, no numbers, per the positioning rules).
- Home suppresses the standard `SiteFooter`; the expanded band renders the footer row instead (same links, one instance of each).
