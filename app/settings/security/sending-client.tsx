"use client";

import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { LoadingList } from "@/components/loading-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

type Sending = {
  confirm_agent_sends: boolean;
  confirm_human_sends: boolean;
};

function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <Checkbox
        aria-label={title}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span className="flex flex-col gap-1">
        <span className="text-sm leading-none font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

export function SendingClient() {
  const [sending, setSending] = useState<Sending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/v1/sending", { credentials: "include" });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/settings/security")}`;
        return;
      }
      const json = (await res.json().catch(() => null)) as Sending | null;
      if (cancelled) return;
      if (!res.ok || !json) {
        setError("Could not load sending settings.");
        setSending({ confirm_agent_sends: true, confirm_human_sends: false });
        return;
      }
      setSending(json);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(patch: Partial<Sending>) {
    if (!sending) return;
    const previous = sending;
    setSending({ ...sending, ...patch });
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/v1/sending", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => null)) as Sending | null;
      if (!res.ok || !json) {
        setSending(previous);
        setError("Could not save. Try again.");
        return;
      }
      setSending(json);
    } catch {
      setSending(previous);
      setError("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MailCheck className="size-4" />
          Send confirmation
        </CardTitle>
        <CardDescription>
          A 6-digit code emailed to you approves a document before it goes to
          signers. API keys are standing authorizations and always send
          without a code, so automations keep working unattended.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {sending === null ? (
          <LoadingList />
        ) : (
          <>
            <ToggleRow
              title="Confirm agent sends"
              description="Documents prepared by a connected agent wait for your code before anything is sent."
              checked={sending.confirm_agent_sends}
              disabled={busy}
              onChange={(v) => save({ confirm_agent_sends: v })}
            />
            <ToggleRow
              title="Confirm my sends"
              description="Also ask for the code when you send from the web yourself."
              checked={sending.confirm_human_sends}
              disabled={busy}
              onChange={(v) => save({ confirm_human_sends: v })}
            />
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
