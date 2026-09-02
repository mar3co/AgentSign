"use client";

import { useEffect, useState } from "react";
import { Plug } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LoadingList } from "@/components/loading-list";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Grant = {
  id: string;
  client_id: string;
  client_name: string;
  scopes: string[];
  agents: { id: string; slug: string; name: string }[];
  created_at: string;
};

function mcpUrl(): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/mcp`;
}

export function ConnectedAppsClient() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/v1/oauth/grants", { credentials: "include" });
    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent("/settings/security")}`;
      return;
    }
    const json = (await res.json().catch(() => null)) as {
      error?: string;
      grants?: Grant[];
    } | null;
    if (!res.ok) {
      setError(json?.error ?? "Could not load connected apps.");
      setGrants([]);
      return;
    }
    setGrants(json?.grants ?? []);
    setError(null);
  }

  useEffect(() => {
    void load();
  }, []);

  async function disconnect(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v1/oauth/grants/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? "Could not disconnect the app.");
        return;
      }
      await load();
    } catch {
      setError("Could not disconnect the app.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-5" aria-hidden />
          Connected apps
        </CardTitle>
        <CardDescription>
          Apps you connected to your account over MCP, such as Claude or Cursor.
          Disconnecting one ends its access right away.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {grants === null ? (
          <LoadingList />
        ) : grants.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="No apps connected"
            description={`Add ${mcpUrl()} to an MCP host to connect one.`}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {grants.map((grant) => (
              <li
                key={grant.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {grant.client_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {grant.scopes.join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {grant.agents.length === 0
                      ? "Cannot attest as any agent"
                      : `Can attest as ${grant.agents.map((a) => a.name).join(", ")}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Connected {new Date(grant.created_at).toLocaleDateString()}
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={<Button type="button" variant="outline" size="sm" />}
                    disabled={busy}
                  >
                    Disconnect
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Disconnect {grant.client_name}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        It loses access to your account right away. Documents it
                        already sent stay. You can connect it again any time.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogClose
                        render={<Button type="button" variant="outline" />}
                      >
                        Keep connected
                      </AlertDialogClose>
                      <AlertDialogClose
                        render={<Button type="button" variant="destructive" />}
                        onClick={() => void disconnect(grant.id)}
                      >
                        Confirm disconnect
                      </AlertDialogClose>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
