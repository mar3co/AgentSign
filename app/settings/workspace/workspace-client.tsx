"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LoadingList } from "@/components/loading-list";
import { SettingsSection } from "@/components/settings-shell";
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
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type Loaded = {
  app_id: string;
  display_name: string | null;
  timezone: string | null;
  description: string | null;
  role: "owner" | "member";
  can_edit: boolean;
};

function timeZones(): string[] {
  if (typeof Intl !== "undefined" && "supportedValuesOf" in Intl) {
    return Intl.supportedValuesOf("timeZone");
  }
  return ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London"];
}

export function WorkspaceClient() {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(timeZones, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/workspace", { credentials: "include" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/settings/workspace")}`;
          return;
        }
        const json = (await res.json().catch(() => null)) as
          | (Loaded & { error?: string })
          | null;
        if (!res.ok || !json?.app_id) {
          if (!cancelled) setError(json?.error ?? "Could not load workspace.");
          return;
        }
        if (!cancelled) setState(json);
      } catch {
        if (!cancelled) setError("Could not load workspace.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) {
    if (error) {
      return (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      );
    }
    return <LoadingList />;
  }

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!state?.can_edit) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch("/v1/workspace", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: String(data.get("display_name") ?? ""),
          timezone: String(data.get("timezone") ?? ""),
          description: String(data.get("description") ?? ""),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | (Loaded & { error?: string })
        | null;
      if (!res.ok) {
        setError(json?.error ?? "Could not save workspace.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Could not save workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function onExport() {
    const res = await fetch("/v1/workspace/export", { credentials: "include" });
    if (!res.ok) {
      setError("Could not export workspace.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workspace.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onLeave() {
    const res = await fetch("/v1/team/leave", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(json?.error ?? "Could not leave the team.");
      return;
    }
    window.location.href = "/settings/workspace";
  }

  async function onDissolve() {
    const res = await fetch("/v1/workspace/dissolve", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(json?.error ?? "Could not dissolve the team.");
      return;
    }
    window.location.href = "/settings/workspace";
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <form onSubmit={onSave} className="flex flex-col gap-6">
        <SettingsSection
          title="Name"
          description="Name for this team. On Pro this is also what signers see on invite mail and the signing page."
        >
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="display_name">Name</Label>
                <Input
                  id="display_name"
                  name="display_name"
                  defaultValue={state.display_name ?? ""}
                  disabled={!state.can_edit}
                  maxLength={80}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="app_id">App ID</Label>
                <Input id="app_id" value={state.app_id} disabled readOnly />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="timezone">Timezone</Label>
                <select
                  id="timezone"
                  name="timezone"
                  defaultValue={state.timezone ?? ""}
                  disabled={!state.can_edit}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Browser default</option>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>
        </SettingsSection>
        <Separator />
        <SettingsSection
          title="Details"
          description="A short note for people on this team. Not shown to signers."
        >
          <Card>
            <CardContent className="flex flex-col gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={state.description ?? ""}
                disabled={!state.can_edit}
                maxLength={500}
                rows={4}
              />
            </CardContent>
          </Card>
        </SettingsSection>
        {state.can_edit ? (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              Save
            </Button>
            {saved ? (
              <p className="text-sm text-muted-foreground">Saved.</p>
            ) : null}
          </div>
        ) : null}
      </form>
      <Separator />
      <SettingsSection
        title="Export"
        description="Download team metadata as JSON. Files and secrets stay out of it."
      >
        <Card>
          <CardContent>
            <Button type="button" variant="outline" onClick={onExport}>
              Export
            </Button>
          </CardContent>
        </Card>
      </SettingsSection>
      <Separator />
      <SettingsSection
        title="Danger zone"
        description={
          state.role === "owner"
            ? "Dissolve removes people from the team. Documents and this login stay."
            : "Leave this team. Your login and your own documents stay."
        }
      >
        <Card>
          <CardContent>
            {state.role === "owner" ? (
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button type="button" variant="destructive" />}
                >
                  Dissolve team
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Dissolve this team?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Members lose access. Documents stay. This login stays.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogClose render={<Button type="button" variant="outline" />}>
                      Keep team
                    </AlertDialogClose>
                    <AlertDialogClose
                      render={<Button type="button" variant="destructive" />}
                      onClick={onDissolve}
                    >
                      Confirm dissolve
                    </AlertDialogClose>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button type="button" variant="destructive" />}
                >
                  Leave team
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Leave this team?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You lose access to this team&apos;s documents. Your login stays.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogClose render={<Button type="button" variant="outline" />}>
                      Stay
                    </AlertDialogClose>
                    <AlertDialogClose
                      render={<Button type="button" variant="destructive" />}
                      onClick={onLeave}
                    >
                      Confirm leave
                    </AlertDialogClose>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </CardContent>
        </Card>
      </SettingsSection>
    </div>
  );
}
