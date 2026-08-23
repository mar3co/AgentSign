"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LinkButton } from "@/components/link-button";
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

export type TeamMember = {
  id: string;
  email: string;
  status: "invited" | "active";
  role: "owner" | "member";
};

export type TeamListProps = {
  entitled: boolean;
  isOwner?: boolean;
  members?: TeamMember[];
  ownerEmail?: string | null;
};

export function TeamList({
  entitled,
  isOwner = false,
  members = [],
  ownerEmail = null,
}: TeamListProps) {
  const [items, setItems] = useState(members);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setItems(members);
  }, [members]);

  if (!entitled) {
    return (
      <Card>
        <CardHeader>
          <CardDescription>
            Pro lets you invite people to this cabinet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LinkButton href="/upgrade">
            Upgrade
          </LinkButton>
        </CardContent>
      </Card>
    );
  }

  async function onInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    try {
      const res = await fetch("/v1/team/invites", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/team")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not invite.");
        return;
      }
      const json = (await res.json()) as Omit<TeamMember, "role">;
      const row = { ...json, role: "member" as const };
      setItems((prev) => {
        const i = prev.findIndex((m) => m.id === row.id || m.email === row.email);
        if (i === -1) return [...prev, row];
        const next = [...prev];
        next[i] = { ...next[i], ...row };
        return next;
      });
      form.reset();
    } catch {
      setError("Could not invite.");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/v1/team/members/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/team")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not remove member.");
        return;
      }
      setItems((prev) => prev.filter((m) => m.id !== id));
    } catch {
      setError("Could not remove member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          {ownerEmail
            ? `Cabinet owner ${ownerEmail}.`
            : "People on this cabinet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {items.length === 0 ? (
          <p className="text-base text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((member) => (
              <li
                key={member.id}
                className="flex items-baseline justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
              >
                <span className="text-base font-medium">{member.email}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {member.status}
                  </span>
                  {isOwner && member.role !== "owner" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => onRemove(member.id)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {isOwner ? (
          <form className="flex flex-col gap-4" onSubmit={onInvite}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
              />
            </div>
            <Button className="self-start" type="submit" disabled={busy}>
              Invite
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
