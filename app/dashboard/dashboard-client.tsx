"use client";

import { useEffect, useState } from "react";
import { Archive, Clock, Flame, Webhook } from "lucide-react";
import {
  DocumentMiniTable,
  StatusBadge,
  type DocumentListItem,
} from "@/app/documents/documents-list";
import { DocumentsFigure } from "@/components/documents-figure";
import { LinkButton } from "@/components/link-button";
import { LoadingList } from "@/components/loading-list";
import { StatCardFigure } from "@/components/shadcn-studio/blocks/stat-card-figure";
import {
  StatCardSpark,
  type SparkPoint,
} from "@/components/shadcn-studio/blocks/stat-card-spark";
import {
  activityInitials,
  activityLine,
  relativeTime,
  useActivity,
} from "@/components/shadcn-studio/blocks/use-activity";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type Stats = {
  total: number;
  by_status: Record<string, number>;
  sent: { this_month: number; last_month: number; agent_share: number };
  completed: { this_month: number; last_month: number };
  daily: Array<{ date: string; human: number; agent: number; completed: number }>;
  median_signing_hours: number | null;
  shredding_soon: number;
  webhooks_30d: { sent: number; failed: number };
};

function deltaBadge(current: number, previous: number): string | undefined {
  if (previous === 0) return current > 0 ? "New" : undefined;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round(hours / 24)} days`;
}

const SENT_SERIES = [
  { key: "human", label: "Human-only", color: "var(--primary)" },
  { key: "agent", label: "With agents", color: "var(--chart-2)" },
];

const COMPLETED_SERIES = [
  { key: "completed", label: "Completed", color: "var(--primary)" },
];

export function DashboardClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [documents, setDocuments] = useState<DocumentListItem[] | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { items: activity } = useActivity();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statsRes, envRes, wsRes] = await Promise.all([
          fetch("/v1/stats", { credentials: "include" }),
          fetch("/v1/documents", { credentials: "include" }),
          fetch("/v1/workspace", { credentials: "include" }),
        ]);
        if (statsRes.status === 401 || envRes.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/dashboard")}`;
          return;
        }
        if (!statsRes.ok || !envRes.ok) {
          if (!cancelled) setError("Could not load the dashboard.");
          return;
        }
        const statsJson = (await statsRes.json()) as Stats;
        const docJson = (await envRes.json()) as {
          documents: Array<DocumentListItem & { created_at?: string }>;
        };
        if (!cancelled) {
          setStats(statsJson);
          setDocuments(
            docJson.documents.map((e) => ({
              ...e,
              createdAt: e.created_at,
              signers: e.signers ?? [],
            })),
          );
          if (wsRes.ok) {
            const ws = (await wsRes.json()) as { timezone?: string | null };
            if (ws.timezone) setTimeZone(ws.timezone);
          }
        }
      } catch {
        if (!cancelled) setError("Could not load the dashboard.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (stats === null || documents === null) {
    return <LoadingList />;
  }

  const recent = [...documents].sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );
  const byStatus = Object.entries(stats.by_status).sort((a, b) => b[1] - a[1]);
  const sentSpark: SparkPoint[] = stats.daily;
  const totalDelta =
    stats.sent.last_month === 0
      ? undefined
      : Math.round(
          ((stats.sent.this_month - stats.sent.last_month) /
            stats.sent.last_month) *
            100,
        );

  const ops: Array<{ icon: typeof Clock; label: string; value: string }> = [
    {
      icon: Clock,
      label: "Median time to signed",
      value:
        stats.median_signing_hours === null
          ? "—"
          : formatHours(stats.median_signing_hours),
    },
    {
      icon: Flame,
      label: "Shredding within 7 days",
      value: String(stats.shredding_soon),
    },
    {
      icon: Webhook,
      label: "Webhooks, last 30 days",
      value:
        stats.webhooks_30d.sent + stats.webhooks_30d.failed === 0
          ? "—"
          : `${stats.webhooks_30d.sent} sent · ${stats.webhooks_30d.failed} failed`,
    },
  ];

  return (
    <div className="grid grid-cols-6 gap-4 md:gap-6">
      <StatCardSpark
        title="Sent this month"
        value={String(stats.sent.this_month)}
        badge={deltaBadge(stats.sent.this_month, stats.sent.last_month)}
        note="vs last month"
        data={sentSpark}
        series={SENT_SERIES}
        className="col-span-2 max-lg:col-span-full"
      />
      <StatCardSpark
        title="Completed this month"
        value={String(stats.completed.this_month)}
        badge={deltaBadge(stats.completed.this_month, stats.completed.last_month)}
        note="vs last month"
        data={sentSpark}
        series={COMPLETED_SERIES}
        className="col-span-2 max-lg:col-span-full"
      />
      <StatCardFigure
        title="All documents"
        badgeContent="All time"
        value={String(stats.total)}
        changePercentage={totalDelta}
        figure={<DocumentsFigure />}
        className="col-span-2 max-lg:col-span-full"
      />

      <Card className="col-span-full gap-0 py-0 xl:col-span-4">
        <div className="flex items-center justify-between gap-4 p-4 md:px-6">
          <CardTitle className="text-base">Recent documents</CardTitle>
          <LinkButton href="/documents" variant="outline" size="sm">
            <Archive className="size-3.5" />
            Open Documents
          </LinkButton>
        </div>
        {recent.length === 0 ? (
          <p className="text-muted-foreground border-t px-6 py-10 text-center text-sm">
            Nothing sent yet. Your latest documents land here.
          </p>
        ) : (
          <div className="border-t">
            <DocumentMiniTable documents={recent} limit={5} timeZone={timeZone} />
          </div>
        )}
      </Card>

      <div className="col-span-full flex flex-col gap-4 md:gap-6 xl:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Where documents stand</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {byStatus.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Send a PDF to see the breakdown.
              </p>
            ) : (
              byStatus.map(([status, count]) => (
                <div key={status} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={status} />
                    <span className="text-sm font-medium">{count}</span>
                  </div>
                  <div className="bg-primary/10 h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{
                        width: `${Math.round((count / stats.total) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Delivery &amp; retention</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {ops.map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <row.icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                <span className="text-muted-foreground flex-1 text-sm">
                  {row.label}
                </span>
                <span className="text-sm font-medium whitespace-nowrap">
                  {row.value}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col">
            {activity === null ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : activity.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Activity on your documents shows up here.
              </p>
            ) : (
              activity.slice(0, 4).map((item, i) => (
                <div key={item.id}>
                  {i > 0 ? <Separator className="my-3" /> : null}
                  <div className="flex items-center gap-3">
                    <Avatar className="size-9">
                      <AvatarFallback className="text-xs">
                        {activityInitials(item)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">
                        {activityLine(item)}
                      </span>
                      <span className="text-muted-foreground text-sm">
                        {relativeTime(item.at)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
