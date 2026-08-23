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

export type PacketRole = {
  signing_order: number;
  role_name: string;
};

export type PacketItem = {
  id: string;
  title: string;
  roles: PacketRole[];
  created_at?: string;
};

export type PacketsListProps = {
  entitled: boolean;
  packets?: PacketItem[];
};

export function PacketsList({ entitled, packets = [] }: PacketsListProps) {
  const [items, setItems] = useState(packets);
  const [roleCount, setRoleCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setItems(packets);
  }, [packets]);

  if (!entitled) {
    return (
      <Card>
        <CardHeader>
          <CardDescription>
            Pro saves a PDF and signer roles so you can send it again.
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

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSentId(null);
    setBusy(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    const names = data
      .getAll("role_name")
      .map((v) => String(v).trim())
      .filter(Boolean);
    data.delete("role_name");
    data.set(
      "roles",
      JSON.stringify(names.map((role_name) => ({ role_name }))),
    );
    const file = data.get("file");
    if (file instanceof File && file.size === 0) data.delete("file");
    try {
      const res = await fetch("/v1/packets", {
        method: "POST",
        credentials: "include",
        body: data,
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/packets")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not save packet.");
        return;
      }
      const json = (await res.json()) as PacketItem;
      setItems((prev) => [json, ...prev]);
      setSaved(true);
      form.reset();
      setRoleCount(1);
    } catch {
      setError("Could not save packet.");
    } finally {
      setBusy(false);
    }
  }

  async function onSend(packet: PacketItem, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSentId(null);
    setBusy(true);
    const data = new FormData(e.currentTarget);
    const roles = [...packet.roles].sort(
      (a, b) => a.signing_order - b.signing_order,
    );
    const signers = roles.map((_, i) => ({
      name: String(data.get(`name-${i}`) ?? "").trim(),
      email: String(data.get(`email-${i}`) ?? "").trim(),
    }));
    try {
      const res = await fetch(`/v1/packets/${packet.id}/send`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signers }),
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/packets")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not send packet.");
        return;
      }
      setSentId(packet.id);
    } catch {
      setError("Could not send packet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          Save a PDF and role names, then send it again with new people.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {items.length === 0 ? (
          <p className="text-base text-muted-foreground">No packets yet.</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {items.map((packet) => {
              const roles = [...(packet.roles ?? [])].sort(
                (a, b) => a.signing_order - b.signing_order,
              );
              return (
                <li
                  key={packet.id}
                  className="flex flex-col gap-3 border-b border-border pb-6 last:border-b-0 last:pb-0"
                >
                  <span className="text-base font-medium">{packet.title}</span>
                  {roles.length > 0 ? (
                    <form
                      className="flex flex-col gap-4"
                      onSubmit={(e) => onSend(packet, e)}
                    >
                      {roles.map((role, i) => (
                        <div key={`${packet.id}-${role.signing_order}-${i}`} className="flex flex-col gap-3">
                          <div className="flex flex-col gap-2">
                            <Label htmlFor={`${packet.id}-name-${i}`}>
                              {role.role_name} name
                            </Label>
                            <Input
                              id={`${packet.id}-name-${i}`}
                              name={`name-${i}`}
                              required
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Label htmlFor={`${packet.id}-email-${i}`}>
                              {role.role_name} email
                            </Label>
                            <Input
                              id={`${packet.id}-email-${i}`}
                              name={`email-${i}`}
                              type="email"
                              required
                              autoComplete="email"
                            />
                          </div>
                        </div>
                      ))}
                      {sentId === packet.id ? (
                        <Alert>
                          <AlertDescription>Sent.</AlertDescription>
                        </Alert>
                      ) : null}
                      <Button
                        className="self-start"
                        type="submit"
                        disabled={busy}
                      >
                        Send
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <form className="flex flex-col gap-4" onSubmit={onCreate}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              required
            />
          </div>
          {Array.from({ length: roleCount }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Label htmlFor={`role_name_${i}`}>Role {i + 1}</Label>
              <Input
                id={`role_name_${i}`}
                name="role_name"
                required
              />
            </div>
          ))}
          <Button
            className="self-start"
            type="button"
            variant="outline"
            onClick={() => setRoleCount((n) => n + 1)}
          >
            Add role
          </Button>
          <div className="flex flex-col gap-2">
            <Label htmlFor="file">PDF</Label>
            <Input
              id="file"
              name="file"
              type="file"
              accept="application/pdf,.pdf"
              required
            />
          </div>
          {saved ? (
            <Alert>
              <AlertDescription>Saved.</AlertDescription>
            </Alert>
          ) : null}
          <Button className="self-start" type="submit" disabled={busy}>
            Save packet
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
