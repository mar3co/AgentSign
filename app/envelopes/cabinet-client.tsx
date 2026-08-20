"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CabinetList,
  type CabinetEnvelope,
} from "./cabinet-list";

export function CabinetClient() {
  const [envelopes, setEnvelopes] = useState<CabinetEnvelope[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/envelopes", { credentials: "include" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/envelopes")}`;
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!cancelled) setError(body?.error ?? "Could not load envelopes.");
          return;
        }
        const json = (await res.json()) as { envelopes: CabinetEnvelope[] };
        if (!cancelled) setEnvelopes(json.envelopes);
      } catch {
        if (!cancelled) setError("Could not load envelopes.");
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

  if (envelopes === null) {
    return <p className="text-base text-muted-foreground">Loading…</p>;
  }

  return <CabinetList envelopes={envelopes} />;
}
