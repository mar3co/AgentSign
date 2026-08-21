"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  PacketsList,
  type PacketItem,
} from "./packets-list";

type Loaded = {
  entitled: boolean;
  packets: PacketItem[];
};

export function PacketsClient() {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/packets", { credentials: "include" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/packets")}`;
          return;
        }
        if (res.status === 403) {
          const body = (await res.json().catch(() => null)) as {
            code?: string;
            error?: string;
          } | null;
          if (body?.code === "pro_required") {
            if (!cancelled) setState({ entitled: false, packets: [] });
            return;
          }
          if (!cancelled) setError(body?.error ?? "Could not load packets.");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!cancelled) setError(body?.error ?? "Could not load packets.");
          return;
        }
        const json = (await res.json()) as { packets?: PacketItem[] };
        if (!cancelled) {
          setState({
            entitled: true,
            packets: json.packets ?? [],
          });
        }
      } catch {
        if (!cancelled) setError("Could not load packets.");
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

  if (state === null) {
    return <p className="text-base text-muted-foreground">Loading…</p>;
  }

  return <PacketsList entitled={state.entitled} packets={state.packets} />;
}
