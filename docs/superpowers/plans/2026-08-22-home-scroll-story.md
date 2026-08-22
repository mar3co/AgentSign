# Home Scroll Story Implementation Plan

> **For agentic workers:** This feature is one tightly-coupled scroll choreography; it is executed inline (superpowers:executing-plans path), not via subagent dispatch.

**Goal:** Build the approved three-chapter scroll story into the home page: sticky send bar, pinned crossfading terminal, value band that becomes the footer.

**Architecture:** One new client component (`ScrollStory`) owns the choreography (sticky bar, chapters, pinned terminal stack, sticky band-footer) and receives the hero as a child so the band's sticky containing block spans hero + chapters. IntersectionObserver drives the active terminal panel and the band expansion; all pinning is CSS `position: sticky`; snap is CSS `scroll-snap-type: y proximity` gated on `prefers-reduced-motion` and the story's presence. Mobile and reduced motion fall back to stacked chapters with the existing disclosure pattern, no JS required.

**Tech Stack:** Next.js 15 App Router, Tailwind v4, lucide-react, Vitest + happy-dom.

**Spec:** docs/superpowers/specs/2026-08-22-home-scroll-story-design.md

## Global Constraints

- Voice: no em dashes; never "a human signs"; "attest" only in verbatim code; sentence case; seal red ≤2 per viewport state.
- Machine content is real API shapes only.
- Human column left, terminal column right, at every breakpoint that shows both.
- Copy verbatim from the spec.

## Tasks

### Task 1: ValueBand expansion support
- Add `expanded?: boolean` (default true) to `components/marketing/value-band.tsx`; bodies stay in the DOM and collapse visually via a grid-rows transition when `expanded` is false.

### Task 2: PageShell chrome
- Public branch: sticky header wrapper (`sticky top-0 z-40`) tagged `data-public-header`; new `showFooter?: boolean` (default true) that suppresses `SiteFooter`.

### Task 3: ScrollStory component
- `components/marketing/scroll-story.tsx` (client): props `hero: ReactNode`, `onChooseFile`, `onDropFiles`.
- Sticky send bar (top offset = measured header height via `--public-header-h`, fallback 81px).
- Chapters grid (left prose column, right pinned terminal stack with crossfade; per-chapter disclosure fallback under `lg` and under reduced motion).
- Sticky bottom band: compact titles while pinned, expands (one-liners + footer row via `SiteFooter`) when the last chapter is in view; static expanded under reduced motion / no JS at page end.
- IO + ResizeObserver guarded for non-browser environments.

### Task 4: Home page restructure
- `app/page.tsx`: hero unchanged, wrapped by `ScrollStory`; remove static `ValueBand`, status section, pricing teaser; `showFooter={false}`.
- `app/globals.css`: snap rule `html:has([data-scroll-story])` under `prefers-reduced-motion: no-preference`.

### Task 5: Tests
- Update `home.test.ts` / `home-hero-ui.test.ts` for the second "Choose a PDF" button.
- New `scroll-story-ui.test.ts`: eyebrow questions, headlines, ledger labels, send-bar pointer + OpenAPI href, real terminal addresses, single footer-link instances, voice checks.

### Task 6: Verify
- Full vitest suite green; browser check at 1440×900 (scroll choreography) and 390×844 (stacking, no overflow); commit and push to PR #4.
