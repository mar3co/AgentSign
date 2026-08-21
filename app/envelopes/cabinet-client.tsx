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
        const json = (await res.json()) as {
          envelopes: Array<CabinetEnvelope & { can_delete?: boolean }>;
        };
        if (!cancelled) {
          setEnvelopes(
            json.envelopes.map((e) => ({
              ...e,
              canDelete: Boolean(e.can_delete),
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

  async function onVoid(id: string) {
    const res = await fetch(`/v1/envelopes/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      setError("Could not void envelope.");
      return;
    }
    setEnvelopes((prev) => (prev ?? []).filter((e) => e.id !== id));
  }

  async function onSavePacket(id: string) {
    const res = await fetch("/v1/packets", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ envelope_id: id }),
    });
    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent("/envelopes")}`;
      return;
    }
    if (res.status === 403) {
      window.location.href = "/upgrade";
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(body?.error ?? "Could not save packet.");
      return;
    }
    window.location.href = "/packets";
  }

  return (
    <CabinetList
      envelopes={envelopes}
      onVoid={onVoid}
      onSavePacket={onSavePacket}
    />
  );
}
