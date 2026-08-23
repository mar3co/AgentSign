"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  BookOpen,
  PanelLeftClose,
  PanelRightClose,
  PenLine,
  Search,
  Send,
} from "lucide-react";
import { NAV, NAV_GROUPS, type NavItem } from "@/components/app-nav";
import { LinkButton } from "@/components/link-button";
import { NavUser } from "@/components/nav-user";
import { ActivityDialog } from "@/components/shadcn-studio/blocks/dialog-activity";
import { SearchDialog } from "@/components/shadcn-studio/blocks/dialog-search";
import { NotificationDropdown } from "@/components/shadcn-studio/blocks/dropdown-notification";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

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
  return currentNav(pathname)?.label ?? "Documents";
}

/* The header sits on the primary band, so the trigger inverts: primary-
   foreground surface, primary glyph. */
function BandSidebarTrigger() {
  const { open, isMobile, openMobile, toggleSidebar } = useSidebar();
  const isOpen = isMobile ? openMobile : open;
  return (
    <Button
      variant="outline"
      size="icon-lg"
      onClick={toggleSidebar}
      className="border-primary-foreground bg-primary-foreground text-primary shadow-none hover:bg-primary-foreground/90 hover:text-primary"
    >
      {isOpen ? <PanelLeftClose /> : <PanelRightClose />}
      <span className="sr-only">Toggle sidebar</span>
    </Button>
  );
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
      {/* shadcn studio application-shell-05: an indigo band across the top,
         a floating card sidebar, and content surfaces overlapping the band on
         a muted canvas. The band is part of the shell's background (.app-band
         in globals.css) — see the comment there for why. */}
      <div className="app-band relative flex min-h-dvh w-full bg-muted">
        <SidebarProvider
          className="bg-transparent"
          style={
            {
              "--sidebar-width": "17.5rem",
              "--sidebar-width-icon": "3.375rem",
            } as CSSProperties
          }
        >
          <Sidebar variant="floating" collapsible="icon" className="p-6 pr-0">
            <SidebarHeader>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="lg"
                    className="gap-2.5"
                    render={<a href="/dashboard" />}
                  >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                      <PenLine className="size-4" />
                    </div>
                    <span className="text-xl font-semibold">AgentSign</span>
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
                            className="h-10 rounded-lg px-3"
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
                  <SidebarMenuButton
                    tooltip="Docs"
                    className="h-10 rounded-lg px-3"
                    render={<a href="/docs" />}
                  >
                    <BookOpen />
                    <span>Docs</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
              <NavUser />
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>
          <div className="z-1 flex min-w-0 flex-1 flex-col py-6">
            <header className="text-primary-foreground">
              <div className="flex items-center justify-between gap-6 px-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-4">
                  <BandSidebarTrigger />
                  <div className="min-w-0">
                    <h1 className="truncate text-lg font-semibold">
                      {pageTitle(pathname)}
                    </h1>
                    {subtitle ? (
                      <p className="hidden truncate text-sm text-primary-foreground/60 sm:block">
                        {subtitle}
                      </p>
                    ) : null}
                  </div>
                </div>
                <SearchDialog
                  className="hidden w-full max-w-72 xl:block"
                  hotkey
                  trigger={
                    <Button className="w-full justify-start bg-primary-foreground/15 font-normal text-primary-foreground/80 shadow-none hover:bg-primary-foreground/25">
                      <Search className="size-4" />
                      <span>Type to search...</span>
                      <kbd className="ml-auto rounded border border-primary-foreground/25 px-1.5 font-sans text-xs text-primary-foreground/60">
                        ⌘K
                      </kbd>
                    </Button>
                  }
                />
                <div className="flex shrink-0 items-center gap-1.5">
                  <SearchDialog
                    className="block xl:hidden"
                    trigger={
                      <Button variant="ghost" size="icon-lg" className="hover:bg-primary-foreground/15 hover:text-primary-foreground">
                        <Search />
                        <span className="sr-only">Search</span>
                      </Button>
                    }
                  />
                  <ActivityDialog
                    trigger={
                      <Button variant="ghost" size="icon-lg" className="hover:bg-primary-foreground/15 hover:text-primary-foreground max-sm:hidden">
                        <Activity />
                        <span className="sr-only">Activity</span>
                      </Button>
                    }
                  />
                  <NotificationDropdown
                    trigger={(unread) => (
                      <Button variant="ghost" size="icon-lg" className="relative hover:bg-primary-foreground/15 hover:text-primary-foreground">
                        <Bell />
                        {unread > 0 ? (
                          <span className="bg-destructive absolute top-[14%] right-[23%] size-2 rounded-full" />
                        ) : null}
                        <span className="sr-only">Notifications</span>
                      </Button>
                    )}
                  />
                  {pathname === "/send" ? null : (
                    <LinkButton
                      href="/send"
                      size="sm"
                      className="ml-1.5 border-primary-foreground bg-primary-foreground text-primary shadow-none hover:bg-primary-foreground/90 hover:text-primary"
                    >
                      <Send className="size-3.5" />
                      <span className="max-sm:sr-only">Send a PDF</span>
                    </LinkButton>
                  )}
                </div>
              </div>
            </header>
            <div className="flex w-full flex-1 flex-col px-4 pt-6 sm:px-6">
              <div className="flex w-full flex-1 flex-col rounded-2xl bg-background p-4 shadow-sm ring-1 ring-sidebar-border md:p-6">
                <main
                  className={cn(
                    "flex w-full flex-1 flex-col gap-4 md:gap-6",
                    widthClassName,
                  )}
                >
                  {children}
                </main>
              </div>
            </div>
            <footer className="flex items-center justify-between gap-3 px-4 pt-4 text-xs text-muted-foreground max-sm:flex-col sm:px-6">
              <p>&copy;{new Date().getFullYear()} AgentSign</p>
              <div className="flex items-center gap-4">
                <a href="/docs" className="hover:text-foreground">
                  Docs
                </a>
                <a href="/terms" className="hover:text-foreground">
                  Terms
                </a>
                <a href="/privacy" className="hover:text-foreground">
                  Privacy
                </a>
              </div>
            </footer>
          </div>
        </SidebarProvider>
      </div>
    </div>
  );
}
