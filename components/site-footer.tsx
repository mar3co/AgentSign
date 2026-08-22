import { Separator } from "@/components/ui/separator";

const LINKS = [
  { href: "/openapi.json", label: "OpenAPI" },
  { href: "/llms.txt", label: "llms.txt" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/upgrade", label: "Pricing" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto px-4 pb-8 pt-6">
      <Separator className="mb-4" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="font-heading text-sm tracking-tight">AgentSign</p>
          <p className="text-xs text-muted-foreground">
            Easy signing for everything.
          </p>
        </div>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-2">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
