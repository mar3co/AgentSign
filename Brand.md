# AgentSign Brand

Easy signing for everything, by people and their AI agents — and a visual identity to match:
**a familiar pen writing digital ink, sealed in wax.**

Decided 2026-08-23 across eight exploration rounds; the full board with every rejected
direction lives at https://claude.ai/code/artifact/43de7672-9703-4768-ab9f-697003075535.

---

## The mark

The lucide `PenLine` pen body, kept smooth and familiar — over a line of **four uniform
pixels** in place of the solid underline. The pen is human; what it writes is data. The last
pixel carries the brand color: the wax seal, the moment the signature completes.

**Geometry (24×24 viewBox):**

| Element | Spec |
| --- | --- |
| Pen | lucide `PenLine` pen path, `stroke-width: 2`, round caps and joins, `currentColor` |
| Pixels | 4 squares, 1.8×1.8, at x = 12 / 15 / 18 / 21, y = 19.2 (exact 3-unit pitch) |
| Accent | last pixel only, `--brand-wax` |
| ≤16px | pen `stroke-width: 2.7`, 3 pixels of 2.0–2.2 (the fourth is dropped; see `app/icon.svg`) |

**Rules:**

- **One wax pixel, ever.** Never color more than the last pixel; never add pixels; never
  recolor the run.
- The pixels sit on one straight baseline — no wave, no stagger, no taper.
- Minimum size 16px. Below 20px, use the 16px-tuned geometry.
- Clear space around the mark: at least the width of one pixel cell (1.8 units) on all sides.
- Mono variant (all `currentColor`) is for one-color contexts only: print, engraving, stamps.

## The wordmark

**Public Sans SemiBold (600), CamelCase "AgentSign", tracking ≈ −1.5%.** Public Sans was
commissioned for U.S. government paperwork — forms, notices, things people sign — and it is
already the site's sans (`--font-sans-face` in `app/layout.tsx`), so the wordmark costs nothing
to render live.

**The wax full-stop:** a standalone wordmark ends in a square wax pixel (0.15em, baseline-
aligned, 0.12em after the "n") — "AgentSign▪". It is the mark's accent pixel migrated into
typography.

**The one-pixel rule applies across the lockup:** when the mark and wordmark appear together,
the wordmark **drops** the full-stop; the mark's accent pixel is the one wax pixel in view.

Display treatment (marketing heroes and deck covers only, never UI): "Agent" in IBM Plex Mono
Medium + "Sign" in a serif italic — the machine types, the human signs. Use sparingly and large.

## Color

Sealing Wax leads. Bond Navy supports. Ink writes.

| Token | Hex | Role |
| --- | --- | --- |
| Wax | `#cc4416` | Brand accent (light): the pixel, primary CTAs, focus rings. White text passes AA at 4.77:1. Do **not** use `#d4491a` for text-bearing fills — it fails AA at 4.40:1. |
| Wax bright | `#ff8a5c` | The same roles on dark grounds; near-black text on it reads at 7.9:1. |
| Wax deep | `#9e330e` | Hover/pressed states, large fills. |
| Wax tint | `#fdeee6` | Selected rows, soft badges, callout backgrounds. |
| Bond Navy | `#2b4c9b` | Support: links, charts, public-site depth. No longer the accent. |
| Ink | `#1c2733` | Text and the pen itself. |
| Bond | `#faf9f6` | Paper ground (public surface). |

CSS: `--brand-wax` is defined in `app/globals.css` (`#cc4416`, `.dark` → `#ff8a5c`) and mapped
to the `brand-wax` Tailwind color via `@theme inline`.

**Wax next to danger:** wax and error-red are luminance-identical (≈1.01:1), so hue alone
cannot separate them. The separation is structural:

- **Only wax gets solid fills.** Destructive actions are outlined/ghost, never filled, and
  never lead a screen.
- Errors always carry an icon and explicit wording in a tinted panel — never a bare
  orange-red block.

## Tiles

| Tile | Use |
| --- | --- |
| Ink tile (`#1c2733`, radius 5.5/24) + paper glyph + **bright-wax pixel** | Avatars on busy surfaces |
| Wax tile (`#cc4416`) + all-white glyph | Sidebar lockup, favicon, marketing avatar, app-store icon — where the brand needs to shout |

Inside the wax tile the glyph is all white (a wax pixel on a wax ground would vanish); the
tile itself is the wax.

## Assets

All vector sources live in `public/brand/`; the favicon is served by Next from `app/icon.svg`.

| File | What it is |
| --- | --- |
| `public/brand/agentsign-mark.svg` | Mark, ink on transparent (light grounds) |
| `public/brand/agentsign-mark-dark.svg` | Mark, paper on transparent (dark grounds) |
| `public/brand/agentsign-mark-mono.svg` | Mark, single `currentColor` (one-color contexts) |
| `public/brand/agentsign-tile.svg` | Ink tile, 512-ready |
| `public/brand/agentsign-tile-wax.svg` | Wax tile, 512-ready |
| `public/brand/agentsign-wordmark.svg` / `-dark` | Standalone wordmark with wax full-stop |
| `public/brand/agentsign-lockup.svg` / `-dark` | Mark + wordmark, no full-stop |
| `app/icon.svg` | Favicon: wax tile, 16px-tuned glyph (3 pixels) |
| `components/brand-mark.tsx` | `AgentSignMark` and `AgentSignWordmark` React components |

The wordmark/lockup SVGs render text in Public Sans, right-anchored so the wax stop keeps a
fixed gap even under font fallback.

**PNG exports** live in `public/brand/png/`:

| File | Size | Source |
| --- | --- | --- |
| `favicon-16.png`, `favicon-32.png` | 16, 32 | `app/icon.svg` |
| `apple-touch-icon-180.png` | 180 | wax tile |
| `tile-wax-512.png`, `tile-ink-512.png` | 512 | tiles |
| `mark-512.png`, `mark-dark-512.png` | 512 | marks |
| `wordmark-4x.png`, `wordmark-dark-4x.png` | 1216w | wordmarks |
| `lockup-4x.png`, `lockup-dark-4x.png` | 1168w | lockups |

To regenerate: `rsvg-convert -w <px> <src>.svg -o <out>.png` (`brew install librsvg`). The
text-bearing SVGs need **Public Sans SemiBold** visible to fontconfig — either install it
system-wide, or download `PublicSans-SemiBold.ttf` from
[uswds/public-sans](https://github.com/uswds/public-sans) into a temp dir and point
`FONTCONFIG_FILE` at a config listing that dir. The variable-weight TTF does not match
correctly under fontconfig; use the static SemiBold.

## In the app

The sidebar header (`components/app-shell.tsx`) renders `AgentSignMark` inside the wax
tile. The glyph is `mono` (all `currentColor`) so a wax pixel does not vanish on a wax
ground; the tile itself is the wax.

```tsx
import { AgentSignMark } from "@/components/brand-mark";

<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-wax text-primary-foreground">
  <AgentSignMark className="size-4" mono />
</div>
```

## Migration notes

Applied 2026-08-23:

- Sidebar mark: `AgentSignMark` replaces lucide `PenLine` in `components/app-shell.tsx`; the
  public header wordmark carries the wax full-stop via `WaxStop`. The in-app lockup uses the
  wax tile with a mono glyph.
- **Dashboard `--app-band`**: retired. The studio indigo / Bond Navy / wax header
  band is gone; the app sits on one muted canvas. Wax stays on the sidebar tile,
  **Send a PDF**, and app focus rings (`--ring`).
- **Dark `--sidebar-primary`**: was `#1447e6`; now Bond Navy. The sidebar lockup uses
  `--brand-wax` directly, not this token.
- **`--seal`**: was `#8c2b2b` (predates this system); now aliases `--brand-wax`, which also
  turns the marketing headlines' colored period into the brand full-stop.
- **Public `--primary` / `--ring`**: were navy; now `--brand-wax` (wax leads CTAs and focus).
- **`--font-sans`** now leads with `var(--font-sans-face)` — the Tailwind utility previously
  named the literal family "Public Sans", which never matched next/font's hashed name, so the
  site silently fell back to the system font.
- **Digital Ink ultramarine** (`#2742f5`) from the exploration: retired, do not use.
