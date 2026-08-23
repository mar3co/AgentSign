"use client";

import type { ReactElement } from "react";

import { BellOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  activityInitials,
  activityLine,
  relativeTime,
  useActivity,
  type ActivityItem,
} from "./use-activity";

type Props = {
  /** A function trigger receives the live unread count (for a badge dot). */
  trigger: ReactElement | ((unread: number) => ReactElement);
  defaultOpen?: boolean;
  align?: "start" | "center" | "end";
};

function NotificationItem({
  item,
  unread,
}: {
  item: ActivityItem;
  unread: boolean;
}) {
  return (
    <DropdownMenuItem
      className="gap-3 px-2 py-3 text-base not-data-[variant=destructive]:focus:**:text-[revert-rule]"
      render={<a href="/documents" />}
    >
      <Avatar className="size-9.5">
        <AvatarFallback>{activityInitials(item)}</AvatarFallback>
      </Avatar>
      <div className="flex w-full flex-col items-start">
        <span className="text-base font-medium">{activityLine(item)}</span>
        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground text-sm">
            {relativeTime(item.at)}
          </span>
          {item.actor_kind === "agent" ? (
            <>
              <div className="bg-primary/30 size-1.5 rounded-full" />
              <span className="text-muted-foreground text-sm">Agent</span>
            </>
          ) : null}
        </div>
      </div>
      {unread ? (
        <div className="bg-primary size-1.5 shrink-0 rounded-full" />
      ) : null}
    </DropdownMenuItem>
  );
}

export function NotificationDropdown({ trigger, defaultOpen, align = "end" }: Props) {
  const { items, unread, seenAt, markSeen } = useActivity();
  const events = items ?? [];
  return (
    <DropdownMenu
      defaultOpen={defaultOpen}
      // Mark on close, not open: the unread markers stay visible while the
      // menu is up and clear once the reader has walked away.
      onOpenChange={(open) => {
        if (!open) markSeen();
      }}
    >
      <DropdownMenuTrigger
        render={typeof trigger === "function" ? trigger(unread) : trigger}
      />
      <DropdownMenuContent className="w-full max-w-xs sm:max-w-122" align={align}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between gap-6">
            <span className="text-muted-foreground text-sm font-normal uppercase">
              Notifications
            </span>
            {unread > 0 ? (
              <Badge variant="secondary" className="bg-primary/10 text-primary font-normal">
                {unread} New
              </Badge>
            ) : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="h-0.5" />

        {items === null ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-sm">
            Loading…
          </p>
        ) : events.length === 0 ? (
          <div className="m-2 rounded-md border border-dashed p-6 text-center">
            <BellOff aria-hidden className="text-muted-foreground mx-auto size-8" />
            <p className="mt-2 text-sm font-medium">Nothing yet</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Activity on your documents shows up here.
            </p>
          </div>
        ) : (
          events.slice(0, 6).map((item, i) => (
            <div key={item.id}>
              {i > 0 ? <DropdownMenuSeparator /> : null}
              <NotificationItem
                item={item}
                unread={new Date(item.at).getTime() > seenAt}
              />
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
