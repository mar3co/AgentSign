"use client";

import { useEffect, useState } from "react";
import { LoadingList } from "@/components/loading-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BrandingForm } from "./branding-form";

type Loaded = {
  entitled: boolean;
  displayName?: string | null;
  hasLogo?: boolean;
  canEdit?: boolean;
};

export function BrandingClient({
  initialEntitled = null,
}: {
  /** Server-resolved entitlement; false skips the probe that would 403. */
  initialEntitled?: boolean | null;
}) {
  const [state, setState] = useState<Loaded | null>(
    initialEntitled === false ? { entitled: false } : null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialEntitled === false) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/branding", { credentials: "include" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/settings/branding")}`;
          return;
        }
        if (res.status === 403) {
          const body = (await res.json().catch(() => null)) as {
            code?: string;
            error?: string;
          } | null;
          if (body?.code === "pro_required") {
            if (!cancelled) setState({ entitled: false });
            return;
          }
          if (!cancelled) setError(body?.error ?? "Could not load branding.");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          if (!cancelled) setError(body?.error ?? "Could not load branding.");
          return;
        }
        const json = (await res.json()) as {
          display_name: string | null;
          has_logo: boolean;
          can_edit: boolean;
        };
        if (!cancelled) {
          setState({
            entitled: true,
            displayName: json.display_name,
            hasLogo: json.has_logo,
            canEdit: json.can_edit,
          });
        }
      } catch {
        if (!cancelled) setError("Could not load branding.");
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

  return (
    <BrandingForm
      entitled={state.entitled}
      displayName={state.displayName}
      hasLogo={state.hasLogo}
      canEdit={state.canEdit}
    />
  );
}
