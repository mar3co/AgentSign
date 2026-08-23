import { cn } from "@/lib/utils";

const PEN_PATH =
  "M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z";

/**
 * The AgentSign mark: the pen over four uniform pixels, accent on the last.
 * Inherits ink from `currentColor`; the accent pixel reads `--brand-wax`
 * (#cc4416 light / #ff8a5c dark, set in globals.css). See Brand.md.
 */
export function AgentSignMark({
  className,
  mono = false,
}: {
  className?: string;
  /** All-ink variant for one-color contexts (print, engraving). */
  mono?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      fill="currentColor"
    >
      <path
        d={PEN_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g shapeRendering="crispEdges">
        <rect x={12} y={19.2} width={1.8} height={1.8} />
        <rect x={15} y={19.2} width={1.8} height={1.8} />
        <rect x={18} y={19.2} width={1.8} height={1.8} />
        <rect
          x={21}
          y={19.2}
          width={1.8}
          height={1.8}
          fill={mono ? "currentColor" : "var(--brand-wax)"}
        />
      </g>
    </svg>
  );
}

/**
 * The square wax full-stop that ends a standalone wordmark. Scales with the
 * surrounding font-size. Use only when the mark is not also in view — the
 * lockup (mark + wordmark) drops the stop so exactly one wax pixel shows.
 */
export function WaxStop({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ml-[0.12em] inline-block size-[0.15em] bg-brand-wax",
        className,
      )}
    />
  );
}

/**
 * Standalone wordmark: Public Sans SemiBold ending in the wax full-stop.
 */
export function AgentSignWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-sans text-xl font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      AgentSign
      <WaxStop />
    </span>
  );
}
