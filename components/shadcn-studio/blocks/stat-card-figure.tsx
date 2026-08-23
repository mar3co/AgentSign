import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/* Stat card with a decorative figure pinned to the corner, after shadcn
   studio's statistics-card-04. */
export function StatCardFigure({
  title,
  badgeContent,
  value,
  changePercentage,
  figure,
  className,
}: {
  title: string;
  badgeContent: string;
  value: string;
  /** Signed percentage; omit when there is nothing to compare against. */
  changePercentage?: number;
  figure: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("relative justify-between overflow-hidden", className)}>
      <CardHeader className="flex flex-col items-start gap-3">
        <span className="text-base font-medium">{title}</span>
        <Badge className="bg-primary/10 text-primary">{badgeContent}</Badge>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <span className="text-2xl font-semibold">{value}</span>
        {changePercentage !== undefined ? (
          <span
            className={cn(
              "text-sm",
              changePercentage >= 0
                ? "text-green-600 dark:text-green-400"
                : "text-destructive",
            )}
          >
            {changePercentage > 0 ? "+" : ""}
            {changePercentage}%
          </span>
        ) : null}
      </CardContent>
      <div aria-hidden className="absolute right-0.5 bottom-0">
        {figure}
      </div>
    </Card>
  );
}
