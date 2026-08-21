import type { ReactNode } from "react";
import { ByteRange } from "@/components/byte-range";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader, type SiteHeaderVariant } from "@/components/site-header";
import { cn } from "@/lib/utils";

const WIDTH = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

export function PageShell({
  variant,
  width = "md",
  sealed = false,
  showRange = true,
  children,
}: {
  variant: SiteHeaderVariant;
  width?: keyof typeof WIDTH;
  sealed?: boolean;
  showRange?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto flex min-h-dvh w-full min-w-0 flex-col", WIDTH[width])}>
      <SiteHeader variant={variant} />
      {showRange ? <ByteRange sealed={sealed} /> : null}
      <main className="flex flex-1 flex-col gap-6 px-4 py-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
