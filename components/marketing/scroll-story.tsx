"use client";

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  Award,
  Bot,
  Code,
  FileDown,
  PenLine,
  Receipt,
  Send,
  User,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import { TerminalPanel } from "@/components/marketing/terminal-panel";
import { ValueBand } from "@/components/marketing/value-band";
import { cn } from "@/lib/utils";

const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.22em] text-tint";
const ROW_LABEL = "font-mono text-[11px] tracking-[0.22em]";

// Sticky offsets fall back to the measured header height; 81px matches the
// public header (22px padding, hairline) when measurement is unavailable.
const HEADER_H = "var(--public-header-h,81px)";

const STATUS_CALL = `$ curl https://agentsign.co/v1/documents/doc_kx3q9 \\
       -H 'authorization: Bearer sign_live_...'
{ "status": "completed", "signers": [ … ], "audit": [ … ] }`;

const AGENT_CALL = `# its own named key. its own receipt.
$ curl -X POST \\
    https://agentsign.co/v1/documents/doc_kx3q9/attest \\
    -H 'authorization: Bearer sign_agent_...'`;

const VERIFY_CALL = `$ curl -F file=@sealed.pdf \\
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
  terminal: {
    eyebrow: string;
    address: string;
    call: string;
    note: string;
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
      eyebrow: "Status",
      address: "GET /v1/documents/{id}",
      call: STATUS_CALL,
      note: "> completed 14:09:41 UTC · kept 7 days unless you keep it",
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
    cta: { label: "Connect your AI agent", href: "/llms.txt" },
    links: [{ href: "/docs", label: "MCP tools →" }],
    terminal: {
      eyebrow: "Your agent's turn",
      address: "POST /v1/documents/{id}/attest",
      call: AGENT_CALL,
      note: "> receipt 4c19…9e2f · recorded 14:02:59 UTC",
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
      eyebrow: "Verify",
      address: "POST /v1/verify",
      call: VERIFY_CALL,
      note: "> anyone can run this. no key.",
    },
  },
] as const;

function ChapterTerminal({ chapter }: { chapter: Chapter }) {
  return (
    <TerminalPanel
      eyebrow={chapter.terminal.eyebrow}
      address={chapter.terminal.address}
    >
      <pre className="overflow-x-auto whitespace-pre text-ledger">
        {chapter.terminal.call}
      </pre>
      <p className="text-[#7e97d8]">{chapter.terminal.note}</p>
    </TerminalPanel>
  );
}

export function ScrollStory({
  hero,
  onChooseFile,
  onDropFiles,
}: {
  hero: ReactNode;
  onChooseFile?: () => void;
  onDropFiles?: (files: FileList) => void;
}) {
  const [active, setActive] = useState(0);
  // Expanded is the no-JS and end-of-page default; the observer collapses the
  // band while earlier chapters are on screen.
  const [expanded, setExpanded] = useState(true);
  // The bar appears only after the hero's own drop zone has left the view, so
  // the send affordance reads as one object condensing, never two at once.
  const [pastHero, setPastHero] = useState(false);
  const [barOver, setBarOver] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const chaptersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const header = document.querySelector<HTMLElement>("[data-public-header]");
    if (!header) return;
    const measure = () =>
      document.documentElement.style.setProperty(
        "--public-header-h",
        `${header.offsetHeight}px`,
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const sections =
      chaptersRef.current?.querySelectorAll<HTMLElement>("[data-chapter]");
    if (!sections?.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.chapter);
          setActive(index);
          setExpanded(index === CHAPTERS.length - 1);
        }
      },
      // A section becomes active when it crosses the middle band of the viewport.
      { rootMargin: "-45% 0px -45% 0px" },
    );
    sections.forEach((section) => io.observe(section));
    // JS is running, so choreography applies: start compact and let the
    // observers set the true state for wherever the page loaded.
    setExpanded(false);
    let heroIo: IntersectionObserver | undefined;
    if (heroRef.current) {
      heroIo = new IntersectionObserver(
        ([entry]) => {
          if (entry) setPastHero(entry.intersectionRatio < 0.12);
        },
        { threshold: [0, 0.12, 0.25] },
      );
      heroIo.observe(heroRef.current);
    }
    return () => {
      io.disconnect();
      heroIo?.disconnect();
    };
  }, []);

  function onBarDrop(e: DragEvent) {
    e.preventDefault();
    setBarOver(false);
    if (e.dataTransfer.files?.length) onDropFiles?.(e.dataTransfer.files);
  }

  return (
    <section data-scroll-story className="flex min-w-0 flex-col">
      <div ref={heroRef} className="pb-16">
        {hero}
      </div>

      <div ref={chaptersRef}>
        {/* Sticky send bar: the drop zone condensed, pinned under the header. */}
        <div
          className={cn(
            "z-30 mx-[calc(50%-50vw)] border-y border-border shadow-[0_6px_18px_rgba(28,39,51,0.05)] transition-[opacity,visibility] duration-300 motion-safe:sticky motion-reduce:transition-none",
            pastHero ? "visible opacity-100" : "invisible opacity-0",
            barOver ? "bg-tint/5" : "bg-card",
          )}
          style={{ top: `calc(${HEADER_H})` }}
        >
          <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-6 px-5 py-2.5 sm:px-8 xl:px-14">
            <div className="flex min-w-0 items-center gap-3.5">
              <button
                type="button"
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
              >
                OpenAPI
              </a>
            </p>
          </div>
        </div>

        {/* Chapters: prose scrolls on the left, one pinned terminal on the right. */}
        <div className="grid min-w-0 gap-8 lg:motion-safe:grid-cols-[minmax(0,1fr)_1px_minmax(0,26rem)] xl:motion-safe:grid-cols-[minmax(0,37.5rem)_1px_minmax(0,1fr)] xl:motion-safe:gap-14">
          <div className="flex min-w-0 flex-col">
            {CHAPTERS.map((chapter, index) => (
              <article
                key={chapter.eyebrow}
                data-chapter={index}
                className="flex flex-col justify-center gap-5 py-12 snap-start lg:motion-safe:min-h-[calc(100dvh-var(--public-header-h,81px)-200px)]"
                style={{
                  scrollMarginTop: `calc(${HEADER_H} + 72px)`,
                }}
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
                {/* Stacked fallback: mobile and reduced motion read the call here. */}
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
          <div className="hidden w-px bg-tint/25 lg:motion-safe:block" />
          <div className="hidden min-w-0 lg:motion-safe:block">
            <div
              className="sticky grid py-12 [&>*]:[grid-area:1/1]"
              style={{ top: `calc(${HEADER_H} + 58px)` }}
            >
              {CHAPTERS.map((chapter, index) => (
                <div
                  key={chapter.eyebrow}
                  className={cn(
                    "flex min-w-0 flex-col transition-opacity duration-500",
                    active === index
                      ? "opacity-100"
                      : "pointer-events-none opacity-0",
                  )}
                >
                  <ChapterTerminal chapter={chapter} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* The value band rides the bottom edge and becomes the footer. */}
      <div className="bottom-0 z-20 mx-[calc(50%-50vw)] bg-background lg:motion-safe:sticky">
        <div className="mx-auto w-full max-w-[1440px] px-5 sm:px-8 xl:px-14">
          <ValueBand expanded={expanded} className="pb-3" />
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-500 ease-out",
              expanded
                ? "grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="overflow-hidden">
              <SiteFooter className="px-0" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
