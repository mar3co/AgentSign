"use client";

import { useEffect, useState } from "react";
import { LoadingList } from "@/components/loading-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  TemplatesList,
  type TemplateItem,
} from "./templates-list";

type Loaded = {
  entitled: boolean;
  templates: TemplateItem[];
};

export function TemplatesClient({
  initialEntitled = null,
}: {
  /** Server-resolved entitlement; false skips the probe that would 403. */
  initialEntitled?: boolean | null;
}) {
  const [state, setState] = useState<Loaded | null>(
    initialEntitled === false ? { entitled: false, templates: [] } : null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialEntitled === false) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/templates", { credentials: "include" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/templates")}`;
          return;
        }
        if (res.status === 403) {
          const body = (await res.json().catch(() => null)) as {
            code?: string;
            error?: string;
          } | null;
          if (body?.code === "pro_required") {
            if (!cancelled) setState({ entitled: false, templates: [] });
            return;
          }
          if (!cancelled) setError(body?.error ?? "Could not load templates.");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!cancelled) setError(body?.error ?? "Could not load templates.");
          return;
        }
        const json = (await res.json()) as { templates?: TemplateItem[] };
        if (!cancelled) {
          setState({
            entitled: true,
            templates: json.templates ?? [],
          });
        }
      } catch {
        if (!cancelled) setError("Could not load templates.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialEntitled]);

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

  return <TemplatesList entitled={state.entitled} templates={state.templates} />;
}
