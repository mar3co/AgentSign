import { PenTool, Share2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { icon: Share2, title: "Always free, open source" },
  { icon: Users, title: "No per-seat pricing" },
  { icon: PenTool, title: "For humans and agents alike" },
] as const;

export function ValueBand({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-y-1.5 border-t border-border pt-2 lg:gap-y-3 lg:pt-3",
        className,
      )}
    >
      {ITEMS.map((item) => (
        <div key={item.title} className="flex min-w-0 items-center gap-2.5">
          <item.icon aria-hidden className="size-4 shrink-0 text-tint" />
          <p className="text-[15px] font-semibold">{item.title}</p>
        </div>
      ))}
    </div>
  );
}
