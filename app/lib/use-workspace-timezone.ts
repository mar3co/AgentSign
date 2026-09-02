"use client";

import { useEffect, useState } from "react";

/**
 * The workspace time zone, for screens that print dates. Null until it
 * loads, and null when the workspace has none, which leaves the caller on
 * the browser's own zone. Failures are silent: the zone is a nicety.
 */
export function useWorkspaceTimezone(): string | null {
  const [timeZone, setTimeZone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/workspace", { credentials: "include" });
        if (!res.ok) return;
        const body = (await res.json()) as { timezone?: string | null };
        if (!cancelled && body.timezone) setTimeZone(body.timezone);
      } catch {
        /* timezone is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return timeZone;
}
