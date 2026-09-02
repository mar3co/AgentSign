"use client";

import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Award,
  Bot,
  ChevronDown,
  Code,
  FileDown,
  PenLine,
  Receipt,
  Send,
  User,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import {
  TERMINAL_FOOTER_LINK,
  TERMINAL_SHELL_CLASS,
  TerminalCode,
  TerminalFooter,
  TerminalPanel,
} from "@/components/marketing/terminal-panel";
import { McpClients } from "@/components/marketing/mcp-clients";
import { ValueBand } from "@/components/marketing/value-band";
import { cn } from "@/lib/utils";

const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.22em] text-tint";
const ROW_LABEL = "font-mono text-[11px] tracking-[0.22em]";

// Sticky offsets fall back to the measured header height; 81px matches the
// public header (22px padding, hairline) when measurement is unavailable.
const HEADER_H = "var(--public-header-h,81px)";

/** Compact "Drop a PDF" strip under the header after the hero drop zone. */
export const PIN_SEND_BAR = false;

/** Sticky machine-column identity. The address is what changes per chapter. */
export const MACHINE_EYEBROW = "For agents & developers";

const STATUS_CALL = `# they signed. this is the trail: who,
# when, and every step we recorded.
# the throwaway key from send can read
# this document only.
$ curl https://agentsign.co/v1/documents/doc_kx3q9 \\
       -H 'authorization: Bearer sign_live_...'
{ "status": "completed", "signers": [ … ], "audit": [ … ] }`;

const AGENT_CALL = `# named key, own receipt. it never
# signs for a person. people still
# finish the PDF by hand.
$ curl -X POST \\
    https://agentsign.co/v1/documents/doc_kx3q9/attest \\
    -H 'authorization: Bearer sign_agent_...'`;

const VERIFY_CALL = `# anyone can run this. no key, no
# account. the file is the proof.
$ curl -F file=@sealed.pdf \\
       https://agentsign.co/v1/verify
{ "valid": true, "human_signatures": 1, "agent_attestations": 1 }`;

type Row = {
  icon: typeof Send;
  label: string;
  seal?: boolean;
  body: string;
};

type Chapter = {
  eyebrow: string;
  headline: ReactNode;
  lede: string;
  rows: readonly Row[];
  closing?: string;
  // The chapter's primary action: a link, or (without href) the choose-a-PDF
  // action. The sticky bar stays secondary; each chapter carries its own CTA.
  cta: { label: string; href?: string };
  links?: readonly { href: string; label: string }[];
  /** MCP host marks under the agent/developer rows. */
  clients?: boolean;
  terminal: {
    address: string;
    call: string;
    note: string;
    footer: ReactNode;
  };
};

const CHAPTERS: readonly Chapter[] = [
  {
    eyebrow: "So what is this?",
    headline: "Accounts are optional",
    lede: "You drop a PDF. Your signer taps a link. An account is never the price of a signature; make one only when you want a place to keep what you've signed. The file comes back sealed, with proof of everything that happened.",
    rows: [
      {
        icon: Send,
        label: "SENT",
        body: "We email your signer a link. They never need an account. Neither did you.",
      },
      {
        icon: PenLine,
        label: "SIGNED",
        body: "They review the PDF, consent, and sign by hand on any device.",
      },
      {
        icon: Award,
        label: "SEALED",
        seal: true,
        body: "You both get the sealed file, the certificate, and the full audit trail. We shred our copy in seven days unless you keep it.",
      },
    ],
    cta: { label: "Choose a PDF" },
    terminal: {
      address: "GET /v1/documents/{id}",
      call: STATUS_CALL,
      note: "> completed 14:09:41 UTC · kept 7 days unless you keep it",
      footer: (
        <TerminalFooter>
          <p>Tmp key from send can GET this id until shred.</p>
        </TerminalFooter>
      ),
    },
  },
  {
    eyebrow: "What do agents have to do with it?",
    headline: "It speaks agent and developer",
    lede: "Every month, more of your paperwork is handled by something that isn't a person. AgentSign is built for that turn, and the audit trail names everyone who took it.",
    rows: [
      {
        icon: User,
        label: "PEOPLE",
        body: "Sign by hand, like always. The pen stays yours.",
      },
      {
        icon: Bot,
        label: "AGENTS",
        body: "Hold a named key and sign off with a cryptographic receipt, never a faked signature.",
      },
      {
        icon: Code,
        label: "DEVELOPERS",
        body: "Get the whole rail: REST, OpenAPI, MCP tools, and webhooks.",
      },
    ],
    cta: { label: "Connect your AI agent", href: "/docs#mcp" },
    links: [{ href: "/docs#mcp", label: "MCP tools →" }],
    clients: true,
    terminal: {
      address: "POST /v1/documents/{id}/attest",
      call: AGENT_CALL,
      note: "> receipt 4c19…9e2f · recorded 14:02:59 UTC",
      footer: (
        <TerminalFooter>
          <p>
            <a className={TERMINAL_FOOTER_LINK} href="/llms.txt">
              /llms.txt
            </a>
          </p>
          <p>
            MCP: <code>send · status · attest · verify</code>
          </p>
        </TerminalFooter>
      ),
    },
  },
  {
    eyebrow: "Why believe any of it?",
    headline: (
      <>
        The file is the proof<span className="text-seal">.</span>
      </>
    ),
    lede: "Every sealed PDF carries its own evidence. Post it back any time; anyone can run the check, no key and no account.",
    rows: [
      {
        icon: Award,
        label: "THE SEAL",
        body: "The file is byte for byte the one that was signed. Any edit breaks it.",
      },
      {
        icon: PenLine,
        label: "THE SIGNATURES",
        body: "Who signed, when they signed, and the consent they gave.",
      },
      {
        icon: Receipt,
        label: "THE RECEIPTS",
        body: "Which named agents signed off, and when.",
      },
    ],
    closing: "The code is open, so you can run the whole service yourself.",
    cta: { label: "See pricing", href: "/upgrade" },
    links: [{ href: "/docs", label: "Read the docs →" }],
    terminal: {
      address: "POST /v1/verify",
      call: VERIFY_CALL,
      note: "> anyone can run this. no key.",
      footer: (
        <TerminalFooter>
          <p>
            <a className={TERMINAL_FOOTER_LINK} href="/docs">
              Docs
            </a>
          </p>
        </TerminalFooter>
      ),
    },
  },
] as const;

function ChapterTerminal({
  chapter,
  className,
  plain,
}: {
  chapter: Chapter;
  className?: string;
  plain?: boolean;
}) {
  return (
    <TerminalPanel
      className={className}
      eyebrow={MACHINE_EYEBROW}
      address={chapter.terminal.address}
      footer={chapter.terminal.footer}
      plain={plain}
    >
      <TerminalCode code={chapter.terminal.call} />
      <p className="shrink-0 text-[#9bb6f0]">{chapter.terminal.note}</p>
    </TerminalPanel>
  );
}

function ScrollCue({ className }: { className?: string }) {
  return (
    <a
      href="#story"
      aria-label="Scroll to what this is"
      className={cn(
        "mx-auto flex min-h-10 flex-col items-center gap-1 pb-2 pt-2 text-tint transition-[opacity,transform] duration-150 hover:opacity-80 active:scale-[0.96]",
        className,
      )}
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.22em]">
        Scroll
      </span>
      <ChevronDown
        data-scroll-cue
        aria-hidden
        strokeWidth={1.5}
        className="size-4"
      />
    </a>
  );
}

const STORY_GRID =
  "grid min-w-0 gap-8 lg:motion-safe:grid-cols-[minmax(0,1fr)_1px_minmax(0,26rem)] xl:motion-safe:grid-cols-[minmax(0,37.5rem)_1px_minmax(0,1fr)] xl:motion-safe:gap-14";

export function ScrollStory({
  hero,
  terminal,
  onChooseFile,
  onDropFiles,
}: {
  hero: ReactNode;
  terminal: ReactElement<{ plain?: boolean; className?: string }>;
  onChooseFile?: () => void;
  onDropFiles?: (files: FileList) => void;
}) {
  // -1 is the hero terminal; 0..n are chapter terminals.
  const [active, setActive] = useState(-1);
  const prevActive = useRef(active);
  // 1 = next chapter (enter from below); -1 = previous (enter from above).
  const swapDir = useRef<0 | 1 | -1>(0);
  if (prevActive.current !== active) {
    swapDir.current = active > prevActive.current ? 1 : -1;
    prevActive.current = active;
  }
  const swap =
    swapDir.current === 1
      ? "down"
      : swapDir.current === -1
        ? "up"
        : undefined;
  const [barOver, setBarOver] = useState(false);
  // Compact bar stays off until the hero drop zone reaches the header, then
  // it takes over as the sticky send affordance.
  const [pinned, setPinned] = useState(false);
  const chaptersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-public-header]");
    const bar = document.querySelector<HTMLElement>("[data-send-bar]");
    const zone = document.querySelector<HTMLElement>("[data-drop-zone]");
    const root = document.documentElement;
    const reduce =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let ticking = false;

    const hideZone = (hide: boolean) => {
      if (!zone) return;
      zone.toggleAttribute("inert", hide);
      if (hide) zone.setAttribute("aria-hidden", "true");
      else zone.removeAttribute("aria-hidden");
    };

    const update = () => {
      ticking = false;
      if (header) {
        root.style.setProperty("--public-header-h", `${header.offsetHeight}px`);
      }
      if (!PIN_SEND_BAR || !zone || reduce?.matches) {
        setPinned(false);
        hideZone(false);
        root.style.setProperty("--send-bar-h", "0px");
        return;
      }
      const headerH = header?.offsetHeight ?? 81;
      const rect = zone.getBoundingClientRect();
      // Height 0 means the zone is not laid out (tests, hidden). +1px covers
      // subpixel docking so the bar pins as it meets the header, not after.
      const next = rect.height > 0 && rect.top <= headerH + 1;
      setPinned(next);
      hideZone(next);
      root.style.setProperty(
        "--send-bar-h",
        next && bar ? `${bar.offsetHeight}px` : "0px",
      );
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    reduce?.addEventListener("change", update);
    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        reduce?.removeEventListener("change", update);
        hideZone(false);
      };
    }
    const ro = new ResizeObserver(update);
    if (header) ro.observe(header);
    if (bar) ro.observe(bar);
    if (zone) ro.observe(zone);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      reduce?.removeEventListener("change", update);
      ro.disconnect();
      hideZone(false);
    };
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const heroEl = document.querySelector<HTMLElement>("[data-hero]");
    const sections =
      chaptersRef.current?.querySelectorAll<HTMLElement>("[data-chapter]");
    if (!heroEl && !sections?.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          if (el.dataset.hero !== undefined) {
            setActive(-1);
            continue;
          }
          setActive(Number(el.dataset.chapter));
        }
      },
      // A section becomes active when it crosses the middle band of the viewport.
      { rootMargin: "-45% 0px -45% 0px" },
    );
    if (heroEl) io.observe(heroEl);
    sections?.forEach((section) => io.observe(section));
    return () => io.disconnect();
  }, []);

  function onBarDrop(e: DragEvent) {
    e.preventDefault();
    setBarOver(false);
    if (e.dataTransfer.files?.length) onDropFiles?.(e.dataTransfer.files);
  }

  return (
    <section data-scroll-story className="flex min-w-0 flex-col">
      {PIN_SEND_BAR ? (
        <div
          data-send-bar
          data-stuck={pinned ? "" : undefined}
          aria-hidden={!pinned}
          inert={!pinned}
          className={cn(
            "fixed inset-x-0 z-30 border-y border-border shadow-[0_6px_18px_rgba(28,39,51,0.05)]",
            "transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
            pinned
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-3 opacity-0",
            barOver ? "bg-tint/5" : "bg-card",
          )}
          style={{ top: `calc(${HEADER_H})` }}
        >
          <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-6 px-5 py-2.5 sm:px-8 xl:px-14">
            <div className="flex min-w-0 items-center gap-3.5">
              <button
                type="button"
                tabIndex={pinned ? 0 : -1}
                className="flex min-w-0 cursor-pointer items-center gap-3.5 text-left"
                onClick={() => onChooseFile?.()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setBarOver(true);
                }}
                onDragLeave={() => setBarOver(false)}
                onDrop={onBarDrop}
              >
                <FileDown
                  aria-hidden
                  strokeWidth={1.5}
                  className="size-[22px] shrink-0 text-tint"
                />
                <span className="truncate font-heading text-[17px]">
                  Drop a PDF to send it
                </span>
              </button>
              <Button
                type="button"
                variant="outline"
                tabIndex={pinned ? 0 : -1}
                className="h-9 shrink-0 px-4 text-[13.5px]"
                onClick={() => onChooseFile?.()}
              >
                Choose a PDF
              </Button>
            </div>
            <p className="hidden items-baseline gap-2.5 whitespace-nowrap font-mono text-[12.5px] md:flex">
              <span className="text-muted-foreground">send from code:</span>
              <span className="text-tint">POST /v1/documents</span>
              <span aria-hidden className="text-input">
                &middot;
              </span>
              <a
                className="text-tint underline-offset-4 hover:underline"
                href="/openapi.json"
                tabIndex={pinned ? 0 : -1}
              >
                OpenAPI
              </a>
            </p>
          </div>
        </div>
      ) : null}

      {/* One two-column grid from the hero through the chapters so the
          machine panel can pin at the hero's size instead of swapping to a
          smaller one below the fold. */}
      <div className={STORY_GRID}>
        <div className="flex min-w-0 flex-col">
          <div data-hero className="flex flex-col">
            <div className="flex flex-1 flex-col justify-start gap-5 pt-4 sm:pt-8 lg:pt-[calc(2rem+1.25rem+2px)] xl:pt-[calc(2rem+1.5rem+2px)]">
              {hero}
              <details className="min-w-0 lg:motion-safe:hidden">
                <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.2em] text-tint">
                  View as machine
                </summary>
                <div className="mt-3">{terminal}</div>
              </details>
            </div>
            <div data-hero-south>
              <ScrollCue className="lg:motion-safe:hidden" />
              <div data-value-band>
                <ValueBand className="pb-2 sm:pb-5" />
              </div>
            </div>
          </div>

          <div
            id="story"
            ref={chaptersRef}
            style={{ scrollMarginTop: HEADER_H }}
          >
            {CHAPTERS.map((chapter, index) => (
              <article
                key={chapter.eyebrow}
                data-chapter={index}
                className="flex flex-col justify-center gap-5 py-12 snap-start"
              >
                <p className={EYEBROW}>{chapter.eyebrow}</p>
                <h2 className="font-heading text-3xl tracking-[-0.01em] md:text-4xl">
                  {chapter.headline}
                </h2>
                <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
                  {chapter.lede}
                </p>
                <div className="flex flex-col gap-5">
                  {chapter.rows.map((row) => (
                    <div key={row.label} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <row.icon
                          aria-hidden
                          strokeWidth={1.7}
                          className={cn(
                            "size-3.5 shrink-0",
                            row.seal ? "text-seal" : "text-tint",
                          )}
                        />
                        <p
                          className={cn(
                            ROW_LABEL,
                            row.seal ? "text-seal" : "text-tint",
                          )}
                        >
                          {row.label}
                        </p>
                      </div>
                      <p className="max-w-prose pl-[22px] text-[15px] leading-relaxed text-muted-foreground">
                        {row.body}
                      </p>
                    </div>
                  ))}
                </div>
                {chapter.clients ? <McpClients /> : null}
                {chapter.closing ? (
                  <p className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
                    {chapter.closing}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-4 pt-1">
                  {chapter.cta.href ? (
                    <a
                      href={chapter.cta.href}
                      className={cn(
                        buttonVariants(),
                        "h-10 bg-seal px-5 text-sm font-semibold text-bond hover:bg-seal/90",
                      )}
                    >
                      {chapter.cta.label}
                    </a>
                  ) : (
                    <Button
                      type="button"
                      className="h-10 bg-seal px-5 text-sm font-semibold text-bond hover:bg-seal/90"
                      onClick={() => onChooseFile?.()}
                    >
                      {chapter.cta.label}
                    </Button>
                  )}
                  {chapter.links?.map((link) => (
                    <a
                      key={link.href}
                      className="text-sm font-medium text-tint underline-offset-4 hover:underline"
                      href={link.href}
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
                <details className="min-w-0 lg:motion-safe:hidden">
                  <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.2em] text-tint">
                    View as machine
                  </summary>
                  <div className="mt-3">
                    <ChapterTerminal chapter={chapter} />
                  </div>
                </details>
              </article>
            ))}
          </div>
        </div>

        <div className="hidden w-px bg-tint/25 lg:motion-safe:block" />
        <div className="hidden min-w-0 lg:motion-safe:block">
          <div
            data-story-terminal
            className="sticky flex min-h-0 flex-col"
            style={{ top: "var(--story-chrome-h)" }}
          >
            <div className="flex min-h-0 flex-1 flex-col pt-4 sm:pt-8">
              <div
                data-terminal-shell
                className={cn(TERMINAL_SHELL_CLASS, "h-full min-h-0 flex-1")}
              >
                {active === -1 ? (
                  <div
                    key="hero"
                    data-hero-terminal
                    data-terminal-swap={swap}
                    className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
                  >
                    {cloneElement(terminal, {
                      plain: true,
                      className: "h-full",
                    })}
                  </div>
                ) : (
                  <div
                    key={active}
                    data-chapter-terminal={active}
                    data-terminal-swap={swap}
                    className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
                  >
                    <ChapterTerminal
                      chapter={CHAPTERS[active]!}
                      plain
                      className="h-full"
                    />
                  </div>
                )}
              </div>
            </div>
            <div
              className={cn("shrink-0", active !== -1 && "invisible")}
              aria-hidden={active !== -1}
              inert={active !== -1 || undefined}
            >
              <ScrollCue className="pb-2 sm:pb-5" />
            </div>
          </div>
        </div>
      </div>

      <div data-story-end>
        <SiteFooter className="px-0" />
      </div>
    </section>
  );
}
