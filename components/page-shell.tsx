import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ByteRange } from "@/components/byte-range";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader, type SiteHeaderVariant } from "@/components/site-header";
import { cn } from "@/lib/utils";

const WIDTH = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-none",
} as const;

// Inside the app shell the content is left-aligned: form pages cap their
// column, list pages take the full inset.
const APP_WIDTH = {
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-none",
  full: "max-w-none",
} as const;

// Comp: 1440px canvas with 56px gutters; the header hairline spans the page.
const PUBLIC_GUTTER = "mx-auto w-full max-w-[1440px] px-5 sm:px-8 xl:px-14";

export function PageShell({
  variant,
  width = "md",
  sealed = false,
  showRange = true,
  showFooter = true,
  flush = false,
  children,
}: {
  variant: SiteHeaderVariant | "app";
  width?: keyof typeof WIDTH;
  sealed?: boolean;
  showRange?: boolean;
  showFooter?: boolean;
  /** Drop main padding so a child can fill the remaining viewport. */
  flush?: boolean;
  children: ReactNode;
}) {
  if (variant === "app") {
    return <AppShell widthClassName={APP_WIDTH[width]}>{children}</AppShell>;
  }
  if (variant === "public" || variant === "auth") {
    return (
      <div
        data-surface="public"
        className="flex min-h-dvh w-full flex-col bg-background"
      >
        <div
          data-public-header
          className="sticky top-0 z-40 border-b border-border bg-background"
        >
          <div className={PUBLIC_GUTTER}>
            <SiteHeader variant={variant} className="px-0 py-[22px]" />
          </div>
        </div>
        {/* The v8 comp has no ByteRange strip on the public surface. */}
        <div className={cn(PUBLIC_GUTTER, "flex min-w-0 flex-1 flex-col")}>
          <main
            className={cn(
              "mx-auto flex w-full min-w-0 flex-1 flex-col gap-10",
              flush ? "py-0" : "py-8",
              WIDTH[width],
            )}
          >
            {children}
          </main>
          {showFooter ? <SiteFooter className="px-0" /> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      <div className={cn("mx-auto flex w-full min-w-0 flex-1 flex-col", WIDTH[width])}>
        <SiteHeader variant={variant} />
        {showRange ? <ByteRange sealed={sealed} /> : null}
        <main className="flex flex-1 flex-col gap-6 px-4 py-6">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
