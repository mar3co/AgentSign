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
import { NavUser } from "@/components/nav-user";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
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

const NAV = [
  { href: "/", label: "Send", icon: Send },
  { href: "/envelopes", label: "Cabinet", icon: Archive },
  { href: "/packets", label: "Packets", icon: Files },
  { href: "/team", label: "Team", icon: Users },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/settings/branding", label: "Branding", icon: Palette },
] as const;

const EXTRA_TITLES: Array<[prefix: string, title: string]> = [
  ["/team/accept", "Team"],
  ["/oauth", "Authorize"],
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function pageTitle(pathname: string): string {
  for (const [prefix, title] of EXTRA_TITLES) {
    if (pathname.startsWith(prefix)) return title;
  }
  const item = NAV.find((n) => isActive(pathname, n.href));
  return item?.label ?? "Cabinet";
}

export function AppShell({
  widthClassName,
  children,
}: {
  widthClassName?: string;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  return (
    <div data-surface="app" className="contents">
      <SidebarProvider>
        <Sidebar collapsible="icon">
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
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAV.map((item) => (
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
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 h-4 data-vertical:self-center"
            />
            <h1 className="text-sm font-medium">{pageTitle(pathname)}</h1>
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
