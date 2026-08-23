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

type Props = {
  trigger: ReactElement;
  defaultOpen?: boolean;
};

// Placeholder feed until activity is wired to real envelope events.
const ITEMS: Array<{
  initials: string;
  actor: string;
  action: string;
  when: string;
  file?: string;
  tags?: string[];
}> = [
  {
    initials: "RC",
    actor: "Riley Chen",
    action: "signed your envelope",
    when: "18 mins ago",
    file: "Offer Letter.pdf",
  },
  {
    initials: "MS",
    actor: "Morgan Silva",
    action: "opened the signing link",
    when: "39 mins ago",
    file: "Mutual NDA.pdf",
  },
  {
    initials: "JP",
    actor: "Jordan Park",
    action: "joined your team",
    when: "1 hour ago",
  },
  {
    initials: "OB",
    actor: "ops-bot",
    action: "sent an envelope via the API",
    when: "8 hours ago",
    tags: ["Agent", "Packet: Onboarding"],
  },
];

export function ActivityDialog({ defaultOpen = false, trigger }: Props) {
  return (
    <Sheet defaultOpen={defaultOpen}>
      <SheetTrigger render={trigger} />
      <SheetContent className="gap-0 sm:data-[side=right]:max-w-md [&>button]:top-2 [&>button>svg]:size-5">
        <SheetHeader className="border-b py-2.25">
          <SheetTitle className="text-lg leading-6">Activity</SheetTitle>
          <SheetDescription hidden />
        </SheetHeader>

        <div className="overflow-y-auto">
          {ITEMS.map((item, i) => (
            <div key={`${item.actor}-${item.when}`}>
              {i > 0 ? <Separator /> : null}
              <div className="flex gap-4 px-4 py-3">
                <Avatar>
                  <AvatarFallback>{item.initials}</AvatarFallback>
                </Avatar>
                <div className="flex w-full flex-col items-start gap-2.5">
                  <div className="text-muted-foreground flex flex-col items-start text-sm">
                    <p>
                      <span className="text-foreground font-semibold">{item.actor}</span>{" "}
                      {item.action}
                    </p>
                    <p>{item.when}</p>
                  </div>
                  {item.file ? (
                    <div className="bg-muted flex items-center gap-1.5 rounded-md border px-2.5 py-1.5">
                      <FileText className="text-muted-foreground size-4" />
                      <span className="text-sm font-medium">{item.file}</span>
                    </div>
                  ) : null}
                  {item.tags ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {item.tags.map((tag) => (
                        <Badge
                          key={tag}
                          className="bg-primary/10 text-primary rounded-sm font-normal"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
