"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive } from "lucide-react";
import {
  EnvelopeMiniTable,
  StatusBadge,
  type CabinetEnvelope,
} from "@/app/envelopes/cabinet-list";
import { EnvelopesFigure } from "@/components/envelopes-figure";
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

const DAY_MS = 86_400_000;

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Latest signature/sign-off on the envelope; how we date a completion. */
function completedAt(env: CabinetEnvelope): Date | null {
  if (env.status !== "completed") return null;
  const times = (env.signers ?? [])
    .flatMap((s) => [s.signed_at, s.attested_at])
    .filter((t): t is string => Boolean(t))
    .map((t) => new Date(t).getTime());
  if (times.length === 0) {
    return env.createdAt ? new Date(env.createdAt) : null;
  }
  return new Date(Math.max(...times));
}

/** Daily counts over the trailing `days`, oldest first. */
function dailySeries(dates: Array<Date | null>, days: number): SparkPoint[] {
  const today = new Date();
  const counts = new Map<string, number>();
  for (const d of dates) {
    if (d) counts.set(dayKey(d), (counts.get(dayKey(d)) ?? 0) + 1);
  }
  const points: SparkPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(today.getTime() - i * DAY_MS);
    points.push({ date: dayKey(day), value: counts.get(dayKey(day)) ?? 0 });
  }
  return points;
}

function deltaBadge(current: number, previous: number): string | undefined {
  if (previous === 0) return current > 0 ? "New" : undefined;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export function DashboardClient() {
  const [envelopes, setEnvelopes] = useState<CabinetEnvelope[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { items: activity } = useActivity();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/envelopes", { credentials: "include" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/dashboard")}`;
          return;
        }
        if (!res.ok) {
          if (!cancelled) setError("Could not load envelopes.");
          return;
        }
        const json = (await res.json()) as {
          envelopes: Array<
            CabinetEnvelope & { created_at?: string; can_delete?: boolean }
          >;
        };
        if (!cancelled) {
          setEnvelopes(
            json.envelopes.map((e) => ({
              ...e,
              createdAt: e.created_at,
              signers: e.signers ?? [],
            })),
          );
        }
      } catch {
        if (!cancelled) setError("Could not load envelopes.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const list = envelopes ?? [];
    const now = new Date();
    const thisMonth = startOfMonth(now);
    const lastMonth = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));

    const created = list.map((e) => (e.createdAt ? new Date(e.createdAt) : null));
    const completed = list.map(completedAt);

    const inMonth = (d: Date | null, from: Date, to: Date) =>
      d !== null && d >= from && d < to;

    const sentThis = created.filter((d) => inMonth(d, thisMonth, now)).length;
    const sentLast = created.filter((d) => inMonth(d, lastMonth, thisMonth)).length;
    const doneThis = completed.filter((d) => inMonth(d, thisMonth, now)).length;
    const doneLast = completed.filter((d) => inMonth(d, lastMonth, thisMonth)).length;

    const byStatus = new Map<string, number>();
    for (const e of list) {
      byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
    }

    return {
      sentThis,
      sentBadge: deltaBadge(sentThis, sentLast),
      sentSeries: dailySeries(created, 14),
      doneThis,
      doneBadge: deltaBadge(doneThis, doneLast),
      doneSeries: dailySeries(completed, 14),
      total: list.length,
      totalDelta:
        sentLast === 0 ? undefined : Math.round(((sentThis - sentLast) / sentLast) * 100),
      byStatus: [...byStatus.entries()].sort((a, b) => b[1] - a[1]),
      recent: [...list].sort((a, b) =>
        (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      ),
    };
  }, [envelopes]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (envelopes === null) {
    return <LoadingList />;
  }

  return (
    <div className="grid grid-cols-6 gap-4 md:gap-6">
      <StatCardSpark
        title="Sent this month"
        value={String(stats.sentThis)}
        badge={stats.sentBadge}
        note="vs last month"
        data={stats.sentSeries}
        className="col-span-2 max-lg:col-span-full"
      />
      <StatCardSpark
        title="Completed this month"
        value={String(stats.doneThis)}
        badge={stats.doneBadge}
        note="vs last month"
        data={stats.doneSeries}
        className="col-span-2 max-lg:col-span-full"
      />
      <StatCardFigure
        title="All envelopes"
        badgeContent="All time"
        value={String(stats.total)}
        changePercentage={stats.totalDelta}
        figure={<EnvelopesFigure />}
        className="col-span-2 max-lg:col-span-full"
      />

      <Card className="col-span-full gap-0 py-0 xl:col-span-4">
        <div className="flex items-center justify-between gap-4 p-4 md:px-6">
          <CardTitle className="text-base">Recent documents</CardTitle>
          <LinkButton href="/envelopes" variant="outline" size="sm">
            <Archive className="size-3.5" />
            Open cabinet
          </LinkButton>
        </div>
        {stats.recent.length === 0 ? (
          <p className="text-muted-foreground border-t px-6 py-10 text-center text-sm">
            Nothing sent yet. Your latest envelopes land here.
          </p>
        ) : (
          <div className="border-t">
            <EnvelopeMiniTable envelopes={stats.recent} limit={5} />
          </div>
        )}
      </Card>

      <div className="col-span-full flex flex-col gap-4 md:gap-6 xl:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Where envelopes stand</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {stats.byStatus.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Send a PDF to see the breakdown.
              </p>
            ) : (
              stats.byStatus.map(([status, count]) => (
                <div key={status} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={status} />
                    <span className="text-sm font-medium">{count}</span>
                  </div>
                  <div className="bg-primary/10 h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${Math.round((count / stats.total) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
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
                Activity on your envelopes shows up here.
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
