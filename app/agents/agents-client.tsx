"use client";

import { useEffect, useState } from "react";
import { LoadingList } from "@/components/loading-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AgentsList, type AgentItem } from "./agents-list";

type Loaded = {
  entitled: boolean;
  canEdit: boolean;
  agents: AgentItem[];
};

export function AgentsClient() {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/agents", { credentials: "include" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/agents")}`;
          return;
        }
        if (res.status === 403) {
          const body = (await res.json().catch(() => null)) as {
            code?: string;
            error?: string;
          } | null;
          if (body?.code === "pro_required") {
            if (!cancelled) setState({ entitled: false, canEdit: false, agents: [] });
            return;
          }
          if (!cancelled) setError(body?.error ?? "Could not load agents.");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!cancelled) setError(body?.error ?? "Could not load agents.");
          return;
        }
        const json = (await res.json()) as {
          agents?: AgentItem[];
          can_edit?: boolean;
        };
        if (!cancelled) {
          setState({
            entitled: true,
            canEdit: Boolean(json.can_edit),
            agents: json.agents ?? [],
          });
        }
      } catch {
        if (!cancelled) setError("Could not load agents.");
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
    return <LoadingList />;
  }

  return (
    <AgentsList
      entitled={state.entitled}
      canEdit={state.canEdit}
      agents={state.agents}
    />
  );
}
