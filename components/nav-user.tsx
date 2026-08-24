"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, KeyRound, LogIn, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

type Session = { state: "loading" } | { state: "out" } | { state: "in"; email: string };

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

async function logOut() {
  try {
    await fetch("/auth/logout", { method: "POST" });
  } finally {
    window.location.href = "/login";
  }
}

export function NavUser() {
  const { isMobile } = useSidebar();
  const [session, setSession] = useState<Session>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/auth/whoami")
      .then(async (res) => {
        if (!res.ok) throw new Error("signed out");
        const json = (await res.json()) as { email?: string };
        if (!cancelled && json.email) {
          setSession({ state: "in", email: json.email });
        } else if (!cancelled) {
          setSession({ state: "out" });
        }
      })
      .catch(() => {
        if (!cancelled) setSession({ state: "out" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (session.state === "loading") {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" aria-hidden className="pointer-events-none">
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg" />
            </Avatar>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  if (session.state === "out") {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="Log in" render={<a href="/login" />}>
            <LogIn />
            <span>Log in</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={session.email}
                className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
              />
            }
          >
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg">
                {initials(session.email)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate text-left text-sm">
              {session.email}
            </span>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                {session.email}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<a href="/settings/passkeys" />}>
              <KeyRound />
              Passkeys
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void logOut()}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
