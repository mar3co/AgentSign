"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function SiteHeader({ variant }: { variant: SiteHeaderVariant }) {
  return (
    <header className="flex items-center justify-between gap-4 px-4 py-4">
      <a
        href="/"
        className="font-heading text-xl leading-none tracking-tight text-foreground"
      >
        AgentSign
      </a>
      {variant === "public" ? (
        <a
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          href="/login"
        >
          Log in
        </a>
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
