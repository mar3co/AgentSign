import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const SETTINGS_TABS = [
  { id: "account", href: "/settings", label: "Account" },
  { id: "workspace", href: "/settings/workspace", label: "Workspace" },
  { id: "security", href: "/settings/security", label: "Security" },
  { id: "branding", href: "/settings/branding", label: "Branding" },
  { id: "billing", href: "/settings/billing", label: "Billing" },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export function SettingsShell({
  current,
  children,
}: {
  current: SettingsTabId;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8">
      <nav
        aria-label="Settings"
        className="flex w-full gap-2 overflow-x-auto border-b border-border"
      >
        {SETTINGS_TABS.map((tab) => {
          const active = tab.id === current;
          return (
            <a
              key={tab.id}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative shrink-0 border-b-2 px-2 pb-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </a>
          );
        })}
      </nav>
      {children}
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-10">
      <div className="space-y-1">
        <h2 className="text-pretty text-sm font-semibold">{title}</h2>
        <p className="text-pretty text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="lg:col-span-2">{children}</div>
    </section>
  );
}
