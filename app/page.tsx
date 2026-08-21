"use client";

import { useRef, useState, type FormEvent } from "react";
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
import { PageShell } from "@/components/page-shell";
import { cn } from "@/lib/utils";

const CURL_EXAMPLE = `curl -F title=Repair\\ authorization \\
     -F sender_email=shop@example.com \\
     -F signers='[{"name":"Jane","email":"jane@example.com"}]' \\
     -F file=@form.pdf \\
     http://localhost:3000/v1/envelopes`;

type Done = { key: string; signUrl: string };

function PdfField() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="file">PDF</Label>
      <label
        htmlFor="file"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const files = e.dataTransfer.files;
          if (!inputRef.current || !files?.length) return;
          inputRef.current.files = files;
          setName(files[0]?.name ?? null);
        }}
        className={cn(
          "flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-6 text-center",
          over ? "border-primary bg-secondary" : "border-input bg-muted/50",
        )}
      >
        <input
          ref={inputRef}
          id="file"
          name="file"
          type="file"
          accept="application/pdf,.pdf"
          required
          className="sr-only"
          onChange={(e) => setName(e.target.files?.[0]?.name ?? null)}
        />
        <span className="font-heading text-lg tracking-tight">Drop a PDF</span>
        <span className="text-sm text-muted-foreground">
          {name ?? "or choose a file"}
        </span>
      </label>
    </div>
  );
}

function CurlAside() {
  return (
    <aside className="flex min-w-0 flex-col gap-6">
      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
          Or curl
        </h2>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre">
          {CURL_EXAMPLE}
        </pre>
      </section>
      <ol className="flex flex-col gap-3 text-sm text-muted-foreground">
        <li>
          <span className="font-mono text-foreground">send</span> the PDF. No
          account.
        </li>
        <li>
          <span className="font-mono text-foreground">sign</span> — a human
          Finishes.
        </li>
        <li>
          <span className="font-mono text-foreground">fetch</span> the sealed
          file.
        </li>
      </ol>
    </aside>
  );
}

export default function Home() {
  const [sent, setSent] = useState(false);
  const [envelopeId, setEnvelopeId] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("signer_name") ?? "").trim();
    const email = String(data.get("signer_email") ?? "").trim();
    data.delete("signer_name");
    data.delete("signer_email");
    data.set("signers", JSON.stringify([{ name, email }]));
    try {
      const res = await fetch("/v1/envelopes", { method: "POST", body: data });
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
      setSent(true);
    } catch {
      setError("Could not send.");
    } finally {
      setBusy(false);
    }
  }

  async function onOtp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!envelopeId) return;
    setError(null);
    setBusy(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    const code = String(data.get("code") ?? "").trim();
    try {
      const res = await fetch(`/v1/envelopes/${envelopeId}/otp`, {
        method: "POST",
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
        signers?: { sign_url?: string | null }[];
      };
      if (!json.key) {
        setError("Could not verify.");
        return;
      }
      setDone({ key: json.key, signUrl: json.signers?.[0]?.sign_url ?? "" });
    } catch {
      setError("Could not verify.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell variant="public" width="xl">
      <section className="flex flex-col gap-3">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
          send · sign · fetch
        </p>
        <h1 className="font-heading text-pretty text-4xl leading-[0.95] tracking-tight break-words md:text-6xl">
          Send a PDF. A human signs. You get a sealed file.
        </h1>
        <p className="max-w-prose text-base text-muted-foreground">
          No account to send. No account to finish. We shred it after a week
          unless you keep it.
        </p>
      </section>

      <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_min(100%,22rem)]">
        {done ? (
          <Alert>
            <AlertDescription className="flex flex-col gap-2">
              <p>Keep this key; it is shown once.</p>
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                {done.key}
              </pre>
              {done.signUrl ? (
                <p>
                  Signer:{" "}
                  <a className="underline" href={done.signUrl}>
                    {done.signUrl}
                  </a>
                </p>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : sent ? (
          <div className="flex flex-col gap-4">
            <Alert>
              <AlertDescription>Check your email for a code.</AlertDescription>
            </Alert>
            <Card>
              <CardHeader>
                <CardTitle>Enter your code</CardTitle>
                <CardDescription>
                  We emailed a 6-digit code. No login required.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="flex flex-col gap-4" onSubmit={onOtp}>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="code">Verification code</Label>
                    <Input
                      id="code"
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      maxLength={6}
                      pattern="[0-9]{6}"
                      className="h-11 text-base md:text-base"
                    />
                  </div>
                  {error ? (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Button
                    className="h-11 w-full text-base"
                    type="submit"
                    disabled={busy}
                  >
                    Verify
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Send a PDF</CardTitle>
              <CardDescription>
                Drop a PDF, name a signer, and we email you a code.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={onSubmit}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    name="title"
                    required
                    className="h-11 text-base md:text-base"
                    defaultValue="Repair authorization"
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
                    className="h-11 text-base md:text-base"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signer_name">Signer name</Label>
                  <Input
                    id="signer_name"
                    name="signer_name"
                    required
                    className="h-11 text-base md:text-base"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="signer_email">Signer email</Label>
                  <Input
                    id="signer_email"
                    name="signer_email"
                    type="email"
                    required
                    autoComplete="email"
                    className="h-11 text-base md:text-base"
                  />
                </div>
                <PdfField />
                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                <Button
                  className="h-11 w-full text-base"
                  type="submit"
                  disabled={busy}
                >
                  Send
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
        <CurlAside />
      </div>
    </PageShell>
  );
}
