import { WaxStop } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

export type SiteHeaderVariant = "public" | "ceremony" | "auth";

export function SiteHeader({
  variant,
  className,
}: {
  variant: SiteHeaderVariant;
  className?: string;
}) {
  const isPublicChrome = variant === "public" || variant === "auth";
  return (
    <header
      className={cn(
        "flex min-w-0 items-center justify-between gap-4 px-4 py-4",
        className,
      )}
    >
      <a
        href="/"
        className={cn(
          "font-heading leading-none text-foreground",
          isPublicChrome
            ? "text-2xl font-semibold tracking-[0.01em]"
            : "text-xl tracking-tight",
        )}
      >
        AgentSign
        <WaxStop />
      </a>
      {variant === "public" ? (
        <nav aria-label="Account" className="flex items-center gap-4 sm:gap-8">
          <a
            className="hidden text-sm text-foreground transition-colors hover:text-tint sm:inline"
            href="/docs"
          >
            Docs
          </a>
          <a
            className="text-sm text-foreground transition-colors hover:text-tint"
            href="/upgrade"
          >
            Pricing
          </a>
          <a
            className="font-mono text-[12.5px] text-tint underline-offset-4 hover:underline"
            href="/llms.txt"
          >
            /llms.txt
          </a>
          <a
            className="rounded-md border border-input px-4 py-2 text-sm transition-colors hover:bg-accent"
            href="/login"
          >
            Log in
          </a>
        </nav>
      ) : null}
      {variant === "auth" ? (
        <a
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          href="/"
        >
          Send a PDF
        </a>
      ) : null}
    </header>
  );
}
