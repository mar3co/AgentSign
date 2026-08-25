"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  BookOpen,
  PanelLeftClose,
  PanelRightClose,
  Search,
  Send,
} from "lucide-react";
import { NAV, NAV_GROUPS, type NavItem } from "@/components/app-nav";
import { AgentSignMark } from "@/components/brand-mark";
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

function AppSidebarTrigger() {
  const { open, isMobile, openMobile, toggleSidebar } = useSidebar();
  const isOpen = isMobile ? openMobile : open;
  return (
    <Button variant="ghost" size="icon-lg" onClick={toggleSidebar}>
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
      {/* Floating sidebar and content cards on one muted canvas. No color
         band: wax stays on the mark tile and the Send CTA. */}
      <div className="relative flex min-h-dvh w-full bg-muted">
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
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-wax text-primary-foreground">
                      <AgentSignMark className="size-4" mono />
                    </div>
                    {/* Lockup: the mark carries the wax pixel, so no full-stop. */}
                    <span className="font-sans text-xl font-semibold">
                      AgentSign
                    </span>
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
            <header>
              <div className="flex items-center justify-between gap-6 px-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-4">
                  <AppSidebarTrigger />
                  <div className="min-w-0">
                    <h1 className="truncate text-lg font-semibold">
                      {pageTitle(pathname)}
                    </h1>
                    {subtitle ? (
                      <p className="hidden truncate text-sm text-muted-foreground sm:block">
                        {subtitle}
                      </p>
                    ) : null}
                  </div>
                </div>
                <SearchDialog
                  className="hidden w-full max-w-72 xl:block"
                  hotkey
                  trigger={
                    <Button
                      variant="outline"
                      className="w-full justify-start font-normal text-muted-foreground shadow-none"
                    >
                      <Search className="size-4" />
                      <span>Type to search...</span>
                      <kbd className="ml-auto rounded border border-border px-1.5 font-sans text-xs text-muted-foreground">
                        ⌘K
                      </kbd>
                    </Button>
                  }
                />
                <div className="flex shrink-0 items-center gap-1.5">
                  <SearchDialog
                    className="block xl:hidden"
                    trigger={
                      <Button variant="ghost" size="icon-lg">
                        <Search />
                        <span className="sr-only">Search</span>
                      </Button>
                    }
                  />
                  <ActivityDialog
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className="max-sm:hidden"
                      >
                        <Activity />
                        <span className="sr-only">Activity</span>
                      </Button>
                    }
                  />
                  <NotificationDropdown
                    trigger={(unread) => (
                      <Button
                        variant="ghost"
                        size="icon-lg"
                        className="relative"
                      >
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
                      className="ml-1.5 border-transparent bg-brand-wax text-primary-foreground shadow-none hover:bg-brand-wax/90 hover:text-primary-foreground"
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
