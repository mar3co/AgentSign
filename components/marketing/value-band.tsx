import { PenTool, Share2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  {
    icon: Share2,
    title: "Always free, open source",
    body: "Apache-2.0. Run it yourself forever, or use the cloud free tier.",
  },
  {
    icon: Users,
    title: "Team plans, no per-seat pricing",
    body: "Pro is one flat price. Invite your whole team. Seats aren't a thing here.",
  },
  {
    icon: PenTool,
    title: "For humans and agents alike",
    body: "People sign by hand. Agents sign off with named keys. Your platform integrates over REST, OpenAPI, or MCP.",
  },
] as const;

export function ValueBand({
  stacked = false,
  className,
}: {
  /** Left-column hero: stacked rows, titles on all sizes, one-liners from xl. */
  stacked?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid border-t border-border",
        stacked
          ? "grid-cols-1 gap-y-1.5 pt-2 lg:gap-y-3 lg:pt-3"
          : "gap-x-6 gap-y-4 pt-5 sm:grid-cols-3",
        className,
      )}
    >
      {ITEMS.map((item) => (
        <div key={item.title} className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <item.icon aria-hidden className="size-4 shrink-0 text-tint" />
            <p className="text-[15px] font-semibold">{item.title}</p>
          </div>
          <p
            className={cn(
              "pl-[26px] text-[13px] leading-relaxed text-muted-foreground",
              stacked && "hidden xl:block",
            )}
          >
            {item.body}
          </p>
        </div>
      ))}
    </div>
  );
}
