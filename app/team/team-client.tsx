"use client";

import { useEffect, useState } from "react";
import { LoadingList } from "@/components/loading-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TeamList, type TeamMember } from "./team-list";

type Loaded = {
  entitled: boolean;
  isOwner: boolean;
  members: TeamMember[];
  ownerEmail: string | null;
};

export function TeamClient() {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/team", { credentials: "include" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/team")}`;
          return;
        }
        const body = (await res.json().catch(() => null)) as {
          owner_email?: string | null;
          members?: TeamMember[];
          entitled?: boolean;
          role?: "owner" | "member";
          code?: string;
          error?: string;
        } | null;
        if (res.status === 403 && body?.code === "pro_required") {
          if (!cancelled) {
            setState({
              entitled: false,
              isOwner: false,
              members: [],
              ownerEmail: null,
            });
          }
          return;
        }
        if (!res.ok) {
          if (!cancelled) setError(body?.error ?? "Could not load team.");
          return;
        }
        if (!cancelled) {
          setState({
            entitled: Boolean(body?.entitled),
            isOwner: body?.role === "owner",
            members: body?.members ?? [],
            ownerEmail: body?.owner_email ?? null,
          });
        }
      } catch {
        if (!cancelled) setError("Could not load team.");
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
    <TeamList
      entitled={state.entitled}
      isOwner={state.isOwner}
      members={state.members}
      ownerEmail={state.ownerEmail}
    />
  );
}
