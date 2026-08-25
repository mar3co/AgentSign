"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import {
  createPasskey,
  isWebAuthnCancel,
  supportsWebAuthn,
} from "@/src/lib/auth/webauthn";
import { LoadingList } from "@/components/loading-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Passkey = {
  id: string;
  friendly_name: string | null;
  created_at: string;
  last_used_at: string | null;
};

export function PasskeysClient() {
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/auth/passkeys", { credentials: "include" });
    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent("/settings/security")}`;
      return;
    }
    const json = (await res.json().catch(() => null)) as {
      error?: string;
      passkeys?: Passkey[];
    } | null;
    if (!res.ok) {
      setError(json?.error ?? "Could not load passkeys.");
      setPasskeys([]);
      return;
    }
    setPasskeys(json?.passkeys ?? []);
    setError(null);
  }

  useEffect(() => {
    void load();
  }, []);

  async function addPasskey() {
    setBusy(true);
    setError(null);
    try {
      const start = await fetch("/auth/passkeys/options", {
        method: "POST",
        credentials: "include",
      });
      const startJson = (await start.json().catch(() => null)) as {
        error?: string;
        challenge_id?: string;
        options?: Record<string, unknown>;
      } | null;
      if (!start.ok || !startJson?.challenge_id || !startJson.options) {
        setError(startJson?.error ?? "Could not create a passkey.");
        return;
      }
      const credential = await createPasskey(startJson.options);
      const res = await fetch("/auth/passkeys", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challenge_id: startJson.challenge_id,
          credential,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(json?.error ?? "Could not save the passkey.");
        return;
      }
      await load();
    } catch (e) {
      if (!isWebAuthnCancel(e)) setError("Could not save the passkey.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/auth/passkeys/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        setError(json?.error ?? "Could not remove the passkey.");
        return;
      }
      await load();
    } catch {
      setError("Could not remove the passkey.");
    } finally {
      setBusy(false);
    }
  }

  if (passkeys === null) return <LoadingList />;

  const canAdd = supportsWebAuthn();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-5" aria-hidden />
          Passkeys
        </CardTitle>
        <CardDescription>
          Use Face ID, Touch ID, or a security key instead of a password next
          time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No passkeys yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {passkeys.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {p.friendly_name || "Passkey"}
                  </p>
                  {p.created_at ? (
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(p.created_at).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void remove(p.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          className="h-11 w-full text-base sm:w-auto"
          disabled={busy || !canAdd}
          onClick={() => void addPasskey()}
        >
          Add a passkey
        </Button>
        {!canAdd ? (
          <p className="text-xs text-muted-foreground">
            This browser does not support passkeys.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
