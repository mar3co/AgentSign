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
  expanded = true,
  className,
}: {
  expanded?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-6 gap-y-4 border-t border-border pt-5 sm:grid-cols-3",
        className,
      )}
    >
      {ITEMS.map((item) => (
        <div key={item.title} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <item.icon aria-hidden className="size-4 text-tint" />
            <p className="text-[15px] font-semibold">{item.title}</p>
          </div>
          {/* Bodies stay in the DOM when compact so the band can expand without a layout jump. */}
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-500 ease-out",
              expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <p className="overflow-hidden pl-[26px] text-[13px] leading-relaxed text-muted-foreground">
              {item.body}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
