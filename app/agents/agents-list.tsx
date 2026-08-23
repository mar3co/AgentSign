"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Bot } from "lucide-react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AgentItem = {
  id: string;
  slug: string;
  name: string;
  has_webhook: boolean;
  created_at?: string;
  revoked_at?: string | null;
};

export type AgentsListProps = {
  entitled: boolean;
  canEdit?: boolean;
  agents?: AgentItem[];
};

export function AgentsList({
  entitled,
  canEdit = false,
  agents = [],
}: AgentsListProps) {
  const [items, setItems] = useState(agents);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [shownSecret, setShownSecret] = useState<string | null>(null);

  useEffect(() => {
    setItems(agents);
  }, [agents]);

  if (!entitled) {
    return (
      <UpgradeGate
        icon={Bot}
        title="Give your agents their own keys"
        description="Pro named agents can attest on envelopes. Free accounts send and download only."
      />
    );
  }

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setShownKey(null);
    setShownSecret(null);
    setBusy(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    const slug = String(data.get("slug") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    const webhookUrl = String(data.get("webhook_url") ?? "").trim();
    try {
      const res = await fetch("/v1/agents", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          name,
          ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
        }),
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/agents")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not create agent.");
        return;
      }
      const json = (await res.json()) as AgentItem & {
        key?: string;
        webhook_secret?: string;
      };
      setItems((prev) => [json, ...prev.filter((a) => a.id !== json.id)]);
      if (json.key) setShownKey(json.key);
      if (json.webhook_secret) setShownSecret(json.webhook_secret);
      form.reset();
    } catch {
      setError("Could not create agent.");
    } finally {
      setBusy(false);
    }
  }

  async function onRotate(id: string) {
    setError(null);
    setShownKey(null);
    setShownSecret(null);
    setBusy(true);
    try {
      const res = await fetch(`/v1/agents/${id}/rotate`, {
        method: "POST",
        credentials: "include",
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/agents")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not rotate key.");
        return;
      }
      const json = (await res.json()) as AgentItem & { key?: string };
      if (json.key) setShownKey(json.key);
    } catch {
      setError("Could not rotate key.");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    setError(null);
    setShownKey(null);
    setShownSecret(null);
    setBusy(true);
    try {
      const res = await fetch(`/v1/agents/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/agents")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not revoke agent.");
        return;
      }
      setItems((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, revoked_at: new Date().toISOString() } : a,
        ),
      );
    } catch {
      setError("Could not revoke agent.");
    } finally {
      setBusy(false);
    }
  }

  async function onWebhook(id: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setShownKey(null);
    setShownSecret(null);
    const webhookUrl = String(new FormData(e.currentTarget).get("webhook_url") ?? "").trim();
    const current = items.find((a) => a.id === id);
    if (!webhookUrl) {
      setError(
        current?.has_webhook
          ? "Enter a URL, or use Clear webhook."
          : "Enter a webhook URL.",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/v1/agents/${id}/webhook`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhook_url: webhookUrl }),
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/agents")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not save webhook.");
        return;
      }
      const json = (await res.json()) as { webhook_secret?: string };
      if (json.webhook_secret) setShownSecret(json.webhook_secret);
      setItems((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, has_webhook: Boolean(webhookUrl) } : a,
        ),
      );
    } catch {
      setError("Could not save webhook.");
    } finally {
      setBusy(false);
    }
  }

  async function onClearWebhook(id: string) {
    setError(null);
    setShownKey(null);
    setShownSecret(null);
    setBusy(true);
    try {
      const res = await fetch(`/v1/agents/${id}/webhook`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ webhook_url: null, clear: true }),
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/agents")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not clear webhook.");
        return;
      }
      setItems((prev) =>
        prev.map((a) => (a.id === id ? { ...a, has_webhook: false } : a)),
      );
    } catch {
      setError("Could not clear webhook.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Named agents that may attest for people on this cabinet.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {shownKey ? (
          <Alert>
            <AlertDescription>
              Copy this key now. {shownKey}
            </AlertDescription>
          </Alert>
        ) : null}
        {shownSecret ? (
          <Alert>
            <AlertDescription>
              Copy this webhook secret now. {shownSecret}
            </AlertDescription>
          </Alert>
        ) : null}
        {items.length === 0 ? (
          <p className="text-base text-muted-foreground">No agents yet.</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {items.map((agent) => {
              const revoked = Boolean(agent.revoked_at);
              return (
                <li
                  key={agent.id}
                  className="flex flex-col gap-3 border-b border-border pb-6 last:border-b-0 last:pb-0"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-base font-medium">
                      {agent.slug}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {agent.name}
                      </span>
                    </span>
                    {revoked ? (
                      <span className="text-sm text-muted-foreground">revoked</span>
                    ) : null}
                  </span>
                  {canEdit && !revoked ? (
                    <span className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => onRotate(agent.id)}
                      >
                        Rotate
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => onRevoke(agent.id)}
                      >
                        Revoke
                      </Button>
                    </span>
                  ) : null}
                  {canEdit && !revoked ? (
                    <form
                      className="flex flex-col gap-3"
                      onSubmit={(e) => onWebhook(agent.id, e)}
                    >
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`webhook-${agent.id}`}>Webhook URL</Label>
                        <Input
                          id={`webhook-${agent.id}`}
                          name="webhook_url"
                          type="url"
                          placeholder={agent.has_webhook ? "Webhook set" : ""}
                        />
                      </div>
                      <span className="flex flex-wrap items-center gap-3">
                        <Button type="submit" disabled={busy}>
                          Save webhook
                        </Button>
                        {agent.has_webhook ? (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => onClearWebhook(agent.id)}
                          >
                            Clear webhook
                          </Button>
                        ) : null}
                      </span>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {canEdit ? (
          <form className="flex flex-col gap-4" onSubmit={onCreate}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                name="slug"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="webhook_url">Webhook URL</Label>
              <Input
                id="webhook_url"
                name="webhook_url"
                type="url"
              />
            </div>
            <Button className="self-start" type="submit" disabled={busy}>
              Create agent
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
