import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/* Empty lists and gated pages, styled after shadcn studio's empty-state-02
   block: one dashed panel with a big quiet icon, a medium one-liner, and the
   CTA living inside the panel. */
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
    <div className="rounded-md border border-dashed p-6 py-10 text-center">
      <Icon aria-hidden className="mx-auto size-12 text-muted-foreground" />
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {titleBadge}
      </div>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
      {children ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
