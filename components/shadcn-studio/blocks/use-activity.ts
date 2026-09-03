"use client";

import { useCallback, useEffect, useState } from "react";

export type ActivityItem = {
  id: string;
  event: string;
  document_id: string;
  title: string;
  actor: string | null;
  actor_kind: "human" | "agent" | null;
  at: string;
};

const SEEN_KEY = "openseal.activity.seen";

function lastSeen(): number {
  try {
    return Number(window.localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** One sentence per event, from the reader's side of the document. */
export function activityLine(item: ActivityItem): string {
  const who = item.actor ?? "A signer";
  const title = `“${item.title}”`;
  switch (item.event) {
    case "sent":
      return `${title} went out for signing`;
    case "opened":
      return `${who} opened ${title}`;
    case "consented":
      return `${who} agreed to sign ${title}`;
    case "signed":
      return `${who} signed ${title}`;
    case "attested":
      return `${who} signed off on ${title}`;
    case "declined":
      return `${who} declined ${title}`;
    case "rejected":
      return `${who} rejected ${title}`;
    case "reminded":
      return `A reminder went out for ${title}`;
    case "expired":
      return `${title} expired unsigned`;
    default:
      return `${title} was updated`;
  }
}

export function activityInitials(item: ActivityItem): string {
  const source = item.actor ?? item.title;
  const words = source.trim().split(/\s+/).slice(0, 2);
  const initials = words.map((w) => w[0]?.toUpperCase() ?? "").join("");
  return initials || "•";
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Recent document events for the header blocks. `items` is null while
 * loading; unread is anything newer than the per-browser seen mark.
 */
export function useActivity() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [seenAt, setSeenAt] = useState(0);

  useEffect(() => {
    setSeenAt(lastSeen());
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/activity", { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) setItems([]);
          return;
        }
        const json = (await res.json()) as { events?: ActivityItem[] };
        if (!cancelled) setItems(json.events ?? []);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unread = (items ?? []).filter(
    (i) => new Date(i.at).getTime() > seenAt,
  ).length;

  const markSeen = useCallback(() => {
    const newest = items?.[0] ? new Date(items[0].at).getTime() : Date.now();
    setSeenAt(newest);
    try {
      window.localStorage.setItem(SEEN_KEY, String(newest));
    } catch {
      // Private windows may refuse storage; the dot just comes back next load.
    }
  }, [items]);

  return { items, unread, seenAt, markSeen };
}
