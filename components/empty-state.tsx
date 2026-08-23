import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** Centered treatment for empty lists and gated pages. */
export function EmptyState({
  icon: Icon,
  title,
  titleBadge,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  titleBadge?: ReactNode;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-5 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
        <Icon aria-hidden className="size-5 text-muted-foreground" />
      </div>
      <div className="flex max-w-md flex-col items-center gap-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {titleBadge}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
