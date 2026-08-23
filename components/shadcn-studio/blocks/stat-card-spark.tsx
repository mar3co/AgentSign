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

export type SparkPoint = { date: string } & Record<string, number | string>;

export type SparkSeries = {
  key: string;
  label: string;
  /** CSS color, e.g. "var(--primary)". */
  color: string;
};

const DEFAULT_SERIES: SparkSeries[] = [
  { key: "value", label: "Count", color: "var(--primary)" },
];

/* Stat card with an area sparkline, after shadcn studio's dashboard-shell-05
   income/expense cards. The number carries the card; the chart is texture.
   Multiple series overlay with a small legend. */
export function StatCardSpark({
  title,
  value,
  badge,
  note,
  data,
  series = DEFAULT_SERIES,
  className,
}: {
  title: string;
  value: string;
  /** Small delta badge, e.g. "+12%"; omit when there is no comparison. */
  badge?: string;
  /** Muted text beside the badge, e.g. "vs last month". */
  note?: string;
  data: SparkPoint[];
  series?: SparkSeries[];
  className?: string;
}) {
  const gradientId = useId();
  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }]),
  ) satisfies ChartConfig;
  return (
    <Card className={className}>
      <CardContent className="flex flex-1 items-center justify-between gap-4 pr-0">
        <div className="flex shrink-0 flex-col justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">{title}</span>
            <span className="text-3xl font-semibold">{value}</span>
          </div>
          <div className="flex flex-col gap-2">
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
            {series.length > 1 ? (
              <div className="flex flex-wrap items-center gap-3">
                {series.map((s) => (
                  <span
                    key={s.key}
                    className="text-muted-foreground flex items-center gap-1.5 text-xs"
                  >
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <ChartContainer
          config={config}
          className="max-h-26.5 w-full max-w-70 flex-1 max-sm:max-w-35"
        >
          <AreaChart data={data} margin={{ left: 4, right: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient
                  key={s.key}
                  id={`${gradientId}-${s.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="10%" stopColor={s.color} stopOpacity={0.9} />
                  <stop offset="90%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            {series.map((s) => (
              <Area
                key={s.key}
                dataKey={s.key}
                type="natural"
                fill={`url(#${gradientId}-${s.key})`}
                stroke={s.color}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
