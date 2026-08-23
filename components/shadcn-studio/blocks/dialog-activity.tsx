"use client";

import type { ReactElement } from "react";

import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  activityInitials,
  relativeTime,
  useActivity,
  type ActivityItem,
} from "./use-activity";

type Props = {
  trigger: ReactElement;
  defaultOpen?: boolean;
};

/** The sheet splits actor and action, so the line drops the leading name. */
function actionLine(item: ActivityItem): string {
  switch (item.event) {
    case "sent":
      return "went out for signing";
    case "opened":
      return "opened the envelope";
    case "consented":
      return "agreed to sign";
    case "signed":
      return "signed the envelope";
    case "attested":
      return "signed off on the envelope";
    case "declined":
      return "declined to sign";
    case "rejected":
      return "rejected the envelope";
    case "reminded":
      return "was sent a reminder";
    case "expired":
      return "expired unsigned";
    default:
      return "was updated";
  }
}

export function ActivityDialog({ defaultOpen = false, trigger }: Props) {
  const { items } = useActivity();
  const events = items ?? [];
  return (
    <Sheet defaultOpen={defaultOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent className="gap-0 sm:data-[side=right]:max-w-md [&>button]:top-2 [&>button>svg]:size-5">
        <SheetHeader className="border-b py-2.25">
          <SheetTitle className="text-lg leading-6">Activity</SheetTitle>
          <SheetDescription hidden />
        </SheetHeader>

        <div className="overflow-y-auto">
          {items === null ? (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              Loading…
            </p>
          ) : events.length === 0 ? (
            <div className="m-4 rounded-md border border-dashed p-6 text-center">
              <FileText
                aria-hidden
                className="text-muted-foreground mx-auto size-8"
              />
              <p className="mt-2 text-sm font-medium">Nothing yet</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Send a PDF and its progress shows up here.
              </p>
            </div>
          ) : (
            events.map((item, i) => (
              <div key={item.id}>
                {i > 0 ? <Separator /> : null}
                <div className="flex gap-4 px-4 py-3">
                  <Avatar>
                    <AvatarFallback>{activityInitials(item)}</AvatarFallback>
                  </Avatar>
                  <div className="flex w-full flex-col items-start gap-2.5">
                    <div className="text-muted-foreground flex flex-col items-start text-sm">
                      <p>
                        <span className="text-foreground font-semibold">
                          {item.actor ?? "Envelope"}
                        </span>{" "}
                        {actionLine(item)}
                      </p>
                      <p>{relativeTime(item.at)}</p>
                    </div>
                    <div className="bg-muted flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
                      <FileText className="text-muted-foreground size-4" />
                      <span className="text-sm font-medium">{item.title}</span>
                    </div>
                    {item.actor_kind === "agent" ? (
                      <Badge className="bg-primary/10 text-primary rounded-sm font-normal">
                        Agent
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
