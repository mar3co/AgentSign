"use client";

import type { ReactElement } from "react";

import { Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  trigger: ReactElement;
  defaultOpen?: boolean;
  align?: "start" | "center" | "end";
};

type Item = {
  initials: string;
  title: string;
  when: string;
  kind: string;
  unread?: boolean;
};

// Placeholder items until notifications are wired to real document events.
const DOCUMENT_ITEMS: Item[] = [
  {
    initials: "RC",
    title: "Riley Chen signed Offer Letter.pdf",
    when: "12 minutes ago",
    kind: "Document signed",
    unread: true,
  },
  {
    initials: "MS",
    title: "Morgan Silva opened your document",
    when: "2 hours ago",
    kind: "Document viewed",
    unread: true,
  },
  {
    initials: "NDA",
    title: "Mutual NDA.pdf completed by all parties",
    when: "6 hours ago",
    kind: "Document completed",
  },
];

const TEAM_ITEMS: Item[] = [
  {
    initials: "JP",
    title: "Jordan Park accepted your team invite",
    when: "1 hour ago",
    kind: "Team",
  },
  {
    initials: "AK",
    title: "An API key was created for agent ops-bot",
    when: "5 hours ago",
    kind: "Agents",
  },
];

function NotificationItem({ item }: { item: Item }) {
  return (
    <DropdownMenuItem className="gap-3 px-2 py-3 text-base not-data-[variant=destructive]:focus:**:text-[revert-rule]">
      <Avatar className="size-9.5">
        <AvatarFallback>{item.initials}</AvatarFallback>
      </Avatar>
      <div className="flex w-full flex-col items-start">
        <span className="text-base font-medium">{item.title}</span>
        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground text-sm">{item.when}</span>
          <div className="bg-primary/30 size-1.5 rounded-full" />
          <span className="text-muted-foreground text-sm">{item.kind}</span>
        </div>
      </div>
      {item.unread ? <div className="bg-primary size-1.5 shrink-0 rounded-full" /> : null}
    </DropdownMenuItem>
  );
}

export function NotificationDropdown({ trigger, defaultOpen, align = "end" }: Props) {
  const unread = [...DOCUMENT_ITEMS, ...TEAM_ITEMS].filter((i) => i.unread).length;
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent className="w-full max-w-xs sm:max-w-122" align={align}>
        <Tabs defaultValue="documents" className="gap-0">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col pb-0">
              <div className="flex items-center justify-between gap-6 pb-2.5">
                <span className="text-muted-foreground text-sm font-normal uppercase">
                  Notifications
                </span>
                <Badge variant="secondary" className="bg-primary/10 text-primary font-normal">
                  {unread} New
                </Badge>
              </div>
              <div className="-mb-0.5 flex items-center justify-between gap-4">
                <TabsList variant="line">
                  <TabsTrigger
                    value="documents"
                    className="group-data-horizontal/tabs:after:-bottom-1"
                  >
                    Documents
                  </TabsTrigger>
                  <TabsTrigger
                    value="team"
                    className="group-data-horizontal/tabs:after:-bottom-1"
                  >
                    Team
                  </TabsTrigger>
                </TabsList>
                <a href="/settings/branding" aria-label="Notification settings">
                  <Settings className="text-foreground size-5" />
                </a>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="mt-0 h-0.5" />

          <TabsContent value="documents">
            {DOCUMENT_ITEMS.map((item, i) => (
              <div key={item.title}>
                {i > 0 ? <DropdownMenuSeparator /> : null}
                <NotificationItem item={item} />
              </div>
            ))}
          </TabsContent>

          <TabsContent value="team">
            {TEAM_ITEMS.map((item, i) => (
              <div key={item.title}>
                {i > 0 ? <DropdownMenuSeparator /> : null}
                <NotificationItem item={item} />
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
