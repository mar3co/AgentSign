"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export type SiteHeaderVariant = "public" | "app" | "ceremony" | "auth";

const APP_LINKS = [
  { href: "/", label: "Send" },
  { href: "/envelopes", label: "Cabinet" },
  { href: "/packets", label: "Packets" },
  { href: "/team", label: "Team" },
  { href: "/agents", label: "Agents" },
  { href: "/settings/branding", label: "Branding" },
] as const;

function AppLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="App" className={className}>
      {APP_LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

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
      {variant === "app" ? (
        <>
          <AppLinks className="hidden items-center gap-4 md:flex" />
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="md:hidden"
                  aria-label="Menu"
                />
              }
            >
              <Menu />
            </SheetTrigger>
            <SheetContent side="right" className="p-0">
              <SheetHeader>
                <SheetTitle>AgentSign</SheetTitle>
              </SheetHeader>
              <AppLinks className="flex flex-col gap-3 px-4 pb-6" />
            </SheetContent>
          </Sheet>
        </>
      ) : null}
    </header>
  );
}
