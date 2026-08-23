"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { LinkButton } from "@/components/link-button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { UploadDropzone } from "@/components/upload-dropzone";

type SignerRow = { name: string; email: string };

type Done = {
  key: string;
  signers: { email: string; sign_url: string | null }[];
};

export function SendClient() {
  const [senderEmail, setSenderEmail] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [signers, setSigners] = useState<SignerRow[]>([
    { name: "", email: "" },
  ]);
  const [envelopeId, setEnvelopeId] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/auth/whoami");
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/send")}`;
          return;
        }
        const json = (await res.json().catch(() => null)) as {
          email?: string;
        } | null;
        if (!cancelled) setSenderEmail(json?.email ?? "");
      } catch {
        if (!cancelled) setSenderEmail("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setSigner(i: number, patch: Partial<SignerRow>) {
    setSigners((prev) =>
      prev.map((row, j) => (j === i ? { ...row, ...patch } : row)),
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const data = new FormData(e.currentTarget);
    data.delete("signer_name");
    data.delete("signer_email");
    data.set(
      "signers",
      JSON.stringify(
        signers.map((s) => ({ name: s.name.trim(), email: s.email.trim() })),
      ),
    );
    try {
      const res = await fetch("/v1/envelopes", {
        method: "POST",
        credentials: "include",
        body: data,
      });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/send")}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not send.");
        return;
      }
      const json = (await res.json()) as { id?: string };
      if (!json.id) {
        setError("Could not send.");
        return;
      }
      setEnvelopeId(json.id);
    } catch {
      setError("Could not send.");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!envelopeId) return;
    setError(null);
    setBusy(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    try {
      const res = await fetch(`/v1/envelopes/${envelopeId}/otp`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not verify.");
        return;
      }
      const json = (await res.json()) as {
        key?: string;
        signers?: { email: string; sign_url: string | null }[];
      };
      if (!json.key) {
        setError("Could not verify.");
        return;
      }
      setDone({ key: json.key, signers: json.signers ?? [] });
    } catch {
      setError("Could not verify.");
    } finally {
      setBusy(false);
    }
  }

  if (senderEmail === null) {
    return <LoadingList />;
  }

  if (done) {
    const first = done.signers.find((s) => s.sign_url);
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              Sent.{" "}
              {first
                ? `${first.email} has their signing link.`
                : "Your signers get their links in order."}
            </p>
            <p>Keep this key; it is shown once.</p>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">
              {done.key}
            </pre>
            {first?.sign_url ? (
              <p>
                Signer link:{" "}
                <a className="underline underline-offset-4" href={first.sign_url}>
                  {first.sign_url}
                </a>
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap items-center gap-3">
          <LinkButton href="/envelopes">Open Cabinet</LinkButton>
          <LinkButton href="/send" variant="outline">
            Send another
          </LinkButton>
        </div>
      </div>
    );
  }

  if (envelopeId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Confirm to send</CardTitle>
          <CardDescription>
            We emailed a 6-digit code to {senderEmail || "you"}. Enter it and
            your signer gets their link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onConfirm}>
            <div className="flex max-w-xs flex-col gap-2">
              <Label htmlFor="code">Verification code</Label>
              <Input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                pattern="[0-9]{6}"
              />
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button className="self-start" type="submit" disabled={busy}>
              Confirm
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <form className="flex flex-col gap-6" onSubmit={onSubmit}>
          <UploadDropzone
            id="file"
            name="file"
            accept="application/pdf,.pdf"
            required
            prompt="Drag & Drop or Choose a PDF to upload"
            hint="Your signer gets an email link in seconds."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                name="title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Repair authorization"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sender_email">Sender email</Label>
              <Input
                id="sender_email"
                name="sender_email"
                type="email"
                required
                autoComplete="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
              />
            </div>
          </div>

          <Separator />

          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">Signers</h3>
            <p className="text-xs text-muted-foreground">
              They sign in the order listed.
            </p>
          </div>

          {signers.map((row, i) => (
            <div
              key={i}
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor={`signer-name-${i}`}>
                  {signers.length > 1 ? `Signer ${i + 1} name` : "Signer name"}
                </Label>
                <Input
                  id={`signer-name-${i}`}
                  name="signer_name"
                  required
                  value={row.name}
                  onChange={(e) => setSigner(i, { name: e.target.value })}
                  placeholder="Jane"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`signer-email-${i}`}>
                  {signers.length > 1
                    ? `Signer ${i + 1} email`
                    : "Signer email"}
                </Label>
                <Input
                  id={`signer-email-${i}`}
                  name="signer_email"
                  type="email"
                  required
                  autoComplete="off"
                  value={row.email}
                  onChange={(e) => setSigner(i, { email: e.target.value })}
                  placeholder="jane@example.com"
                />
              </div>
              {signers.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove signer ${i + 1}`}
                  onClick={() =>
                    setSigners((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  <X />
                </Button>
              ) : null}
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() =>
              setSigners((prev) => [...prev, { name: "", email: "" }])
            }
          >
            <Plus />
            Add signer
          </Button>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button className="self-start px-8" type="submit" disabled={busy}>
            Send
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
