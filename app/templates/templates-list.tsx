"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Files } from "lucide-react";
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
import { UploadDropzone } from "@/components/upload-dropzone";
import { Separator } from "@/components/ui/separator";

export type TemplateRole = {
  signing_order: number;
  role_name: string;
};

export type TemplateItem = {
  id: string;
  title: string;
  roles: TemplateRole[];
  created_at?: string;
};

export type TemplatesListProps = {
  entitled: boolean;
  templates?: TemplateItem[];
};

export function TemplatesList({ entitled, templates = [] }: TemplatesListProps) {
  const [items, setItems] = useState(templates);
  const [roleCount, setRoleCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [sentId, setSentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setItems(templates);
  }, [templates]);

  if (!entitled) {
    return (
      <UpgradeGate
        icon={Files}
        title="Save setups you reuse"
        description="Pro saves a PDF and signer roles so you can send it again."
      />
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
      const res = await fetch("/v1/templates", {
        method: "POST",
        credentials: "include",
        body: data,
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/templates")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not save template.");
        return;
      }
      const json = (await res.json()) as TemplateItem;
      setItems((prev) => [json, ...prev]);
      setSaved(true);
      form.reset();
      setRoleCount(1);
    } catch {
      setError("Could not save template.");
    } finally {
      setBusy(false);
    }
  }

  async function onSend(template: TemplateItem, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSentId(null);
    setBusy(true);
    const data = new FormData(e.currentTarget);
    const roles = [...template.roles].sort(
      (a, b) => a.signing_order - b.signing_order,
    );
    const signers = roles.map((_, i) => ({
      name: String(data.get(`name-${i}`) ?? "").trim(),
      email: String(data.get(`email-${i}`) ?? "").trim(),
    }));
    try {
      const res = await fetch(`/v1/templates/${template.id}/send`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signers }),
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/templates")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not send template.");
        return;
      }
      setSentId(template.id);
    } catch {
      setError("Could not send template.");
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
          <p className="text-base text-muted-foreground">No templates yet.</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {items.map((template) => {
              const roles = [...(template.roles ?? [])].sort(
                (a, b) => a.signing_order - b.signing_order,
              );
              return (
                <li
                  key={template.id}
                  className="flex flex-col gap-3 border-b border-border pb-6 last:border-b-0 last:pb-0"
                >
                  <span className="text-base font-medium">{template.title}</span>
                  {roles.length > 0 ? (
                    <form
                      className="flex flex-col gap-4"
                      onSubmit={(e) => onSend(template, e)}
                    >
                      {roles.map((role, i) => (
                        <div key={`${template.id}-${role.signing_order}-${i}`} className="flex flex-col gap-3">
                          <div className="flex flex-col gap-2">
                            <Label htmlFor={`${template.id}-name-${i}`}>
                              {role.role_name} name
                            </Label>
                            <Input
                              id={`${template.id}-name-${i}`}
                              name={`name-${i}`}
                              required
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Label htmlFor={`${template.id}-email-${i}`}>
                              {role.role_name} email
                            </Label>
                            <Input
                              id={`${template.id}-email-${i}`}
                              name={`email-${i}`}
                              type="email"
                              required
                              autoComplete="email"
                            />
                          </div>
                        </div>
                      ))}
                      {sentId === template.id ? (
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
        <Separator />
        <form className="flex flex-col gap-4" onSubmit={onCreate}>
          <h3 className="text-sm font-semibold">Save a new template</h3>
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
            <Label htmlFor="file">Document</Label>
            <UploadDropzone
              id="file"
              name="file"
              accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              required
              prompt="Drag & Drop or Choose a PDF or DOCX to upload"
              hint="This PDF is reused every time the template is sent."
            />
          </div>
          {saved ? (
            <Alert>
              <AlertDescription>Saved.</AlertDescription>
            </Alert>
          ) : null}
          <Button className="self-start" type="submit" disabled={busy}>
            Save template
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
