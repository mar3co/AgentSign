"use client";

import { useId } from "react";
import { Area, AreaChart } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export type SparkPoint = { date: string; value: number };

/* Stat card with an area sparkline, after shadcn studio's dashboard-shell-05
   income/expense cards. The number carries the card; the chart is texture. */
export function StatCardSpark({
  title,
  value,
  badge,
  note,
  data,
  className,
}: {
  title: string;
  value: string;
  /** Small delta badge, e.g. "+12%"; omit when there is no comparison. */
  badge?: string;
  /** Muted text beside the badge, e.g. "vs last month". */
  note?: string;
  data: SparkPoint[];
  className?: string;
}) {
  const gradientId = useId();
  const config = { value: { label: title } } satisfies ChartConfig;
  return (
    <Card className={className}>
      <CardContent className="flex flex-1 items-center justify-between gap-4 pr-0">
        <div className="flex shrink-0 flex-col justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">{title}</span>
            <span className="text-3xl font-semibold">{value}</span>
          </div>
          <div className="flex items-center gap-3">
            {badge ? (
              <Badge className="bg-primary/10 text-primary h-6 rounded-sm px-3 py-1">
                {badge}
              </Badge>
            ) : null}
            {/* The note reads as a comparison, so it only appears with one. */}
            {badge && note ? (
              <span className="text-muted-foreground text-sm">{note}</span>
            ) : null}
          </div>
        </div>
        <ChartContainer
          config={config}
          className="max-h-26.5 w-full max-w-70 flex-1 max-sm:max-w-35"
        >
          <AreaChart data={data} margin={{ left: 4, right: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="10%" stopColor="var(--primary)" stopOpacity={1} />
                <stop offset="90%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
            <Area
              dataKey="value"
              type="natural"
              fill={`url(#${gradientId})`}
              stroke="var(--primary)"
              strokeWidth={2}
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
