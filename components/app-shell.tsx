"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  Archive,
  BookOpen,
  Bot,
  Files,
  Palette,
  PenLine,
  Send,
  Users,
} from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { NavUser } from "@/components/nav-user";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  subtitle: string;
  icon: typeof Send;
};

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Workspace",
    items: [
      {
        href: "/",
        label: "Send",
        subtitle: "Send a PDF for signature.",
        icon: Send,
      },
      {
        href: "/envelopes",
        label: "Cabinet",
        subtitle: "Envelopes you have sent and where they stand.",
        icon: Archive,
      },
      {
        href: "/packets",
        label: "Packets",
        subtitle: "Reusable setups for envelopes you send often.",
        icon: Files,
      },
    ],
  },
  {
    label: "Organization",
    items: [
      {
        href: "/team",
        label: "Team",
        subtitle: "People who share this cabinet.",
        icon: Users,
      },
      {
        href: "/agents",
        label: "Agents",
        subtitle: "API keys, OAuth clients, and webhooks.",
        icon: Bot,
      },
      {
        href: "/settings/branding",
        label: "Branding",
        subtitle: "How your envelopes look to signers.",
        icon: Palette,
      },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((group) => group.items);

const EXTRA_TITLES: Array<[prefix: string, title: string]> = [
  ["/team/accept", "Team"],
  ["/oauth", "Authorize"],
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function currentNav(pathname: string): NavItem | undefined {
  return NAV.find((n) => isActive(pathname, n.href));
}

function pageTitle(pathname: string): string {
  for (const [prefix, title] of EXTRA_TITLES) {
    if (pathname.startsWith(prefix)) return title;
  }
  return currentNav(pathname)?.label ?? "Cabinet";
}

export function AppShell({
  widthClassName,
  children,
}: {
  widthClassName?: string;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const subtitle = currentNav(pathname)?.subtitle;
  return (
    <div data-surface="app" className="contents">
      <SidebarProvider>
        <Sidebar collapsible="icon" variant="floating">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  render={<a href="/envelopes" />}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <PenLine className="size-4" />
                  </div>
                  <span className="text-sm font-semibold">AgentSign</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            {NAV_GROUPS.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={isActive(pathname, item.href)}
                          tooltip={item.label}
                          render={<a href={item.href} />}
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Docs" render={<a href="/docs" />}>
                  <BookOpen />
                  <span>Docs</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <NavUser />
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 h-4 data-vertical:self-center"
            />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">
                {pageTitle(pathname)}
              </h1>
              {subtitle ? (
                <p className="hidden truncate text-xs text-muted-foreground sm:block">
                  {subtitle}
                </p>
              ) : null}
            </div>
            {pathname !== "/" ? (
              <LinkButton href="/" size="sm" className="ml-auto">
                <Send className="size-3.5" />
                Send a PDF
              </LinkButton>
            ) : null}
          </header>
          <main
            className={cn(
              "flex w-full flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6",
              widthClassName,
            )}
          >
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
