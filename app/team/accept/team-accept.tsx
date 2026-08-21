"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type TeamAcceptProps = {
  token: string;
  email?: string;
  needsLogin?: boolean;
};

function loginHref(token: string, email: string): string {
  const next = `/team/accept?token=${token}`;
  return `/login?${new URLSearchParams({ email, next })}`;
}

export function TeamAccept({
  token,
  email = "",
  needsLogin = false,
}: TeamAcceptProps) {
  if (needsLogin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Join the cabinet</CardTitle>
          <CardDescription>
            Log in with the invited email to accept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a className="text-sm underline" href={loginHref(token, email)}>
            Log in
          </a>
        </CardContent>
      </Card>
    );
  }

  return <TeamAcceptSession token={token} />;
}

function TeamAcceptSession({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        if (!cancelled) setError("This invite link is missing a token.");
        return;
      }
      try {
        const res = await fetch("/team/accept", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        if (res.status === 401) {
          window.location.href = loginHref(token, "");
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
            code?: string;
          } | null;
          if (body?.code === "forbidden") {
            setError("This invite is for a different email.");
            return;
          }
          setError(body?.error ?? "Could not accept invite.");
          return;
        }
        setDone(true);
      } catch {
        if (!cancelled) setError("Could not accept invite.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Joined</CardTitle>
          <CardDescription>You are on this cabinet.</CardDescription>
        </CardHeader>
        <CardContent>
          <a className="text-sm underline" href="/team">
            Team
          </a>
        </CardContent>
      </Card>
    );
  }

  return <p className="text-base text-muted-foreground">Accepting…</p>;
}
