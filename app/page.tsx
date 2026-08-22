"use client";

import { useRef, useState, type FormEvent } from "react";
import { FileDown } from "lucide-react";
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
import { ScrollStory } from "@/components/marketing/scroll-story";
import { TerminalPanel } from "@/components/marketing/terminal-panel";
import { TwoReader } from "@/components/marketing/two-reader";
import { cn } from "@/lib/utils";

const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.22em] text-tint";

const AGENT_BLOCK = `# your agent can sign off too, with its own
# named key. it gets a cryptographic
# receipt, not a pretend signature
$ curl -X POST \\
    https://agentsign.co/v1/envelopes/env_kx3q9/attest \\
    -H 'authorization: Bearer sign_agent_...'
> receipt 4c19…9e2f · recorded 14:02:59 UTC`;

function curlFor(v: {
  title: string;
  senderEmail: string;
  signerName: string;
  signerEmail: string;
  fileName: string | null;
}) {
  const esc = (s: string) => s.replace(/'/g, "'\\''");
  return [
    `$ curl -F title='${esc(v.title || "Repair authorization")}' \\`,
    `       -F sender_email=${v.senderEmail || "you@example.com"} \\`,
    `       -F signers='[{"name":"${esc(v.signerName || "Jane")}",`,
    `         "email":"${v.signerEmail || "jane@example.com"}"}]' \\`,
    `       -F file=@${v.fileName || "form.pdf"} \\`,
    `       https://agentsign.co/v1/envelopes`,
  ].join("\n");
}

type Done = { key: string; signUrl: string };

export default function Home() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [over, setOver] = useState(false);
  const [title, setTitle] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [envelopeId, setEnvelopeId] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(name: string | null) {
    setFileName(name);
    if (name) setExpanded(true);
  }

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

  const sender = (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-4 rounded-[8px] border-[1.5px] border-dashed px-5 py-5 shadow-[0_1px_0_#e6e3da,0_12px_28px_rgba(28,39,51,0.06)]",
          over ? "border-tint bg-tint/5" : "border-[#9faec9] bg-card",
        )}
      >
        <label
          htmlFor="file"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-4"
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const files = e.dataTransfer.files;
            if (!fileRef.current || !files?.length) return;
            fileRef.current.files = files;
            onFile(files[0]?.name ?? null);
          }}
        >
          <input
            ref={fileRef}
            id="file"
            name="file"
            type="file"
            accept="application/pdf,.pdf"
            required
            className="sr-only"
            onChange={(e) => onFile(e.target.files?.[0]?.name ?? null)}
          />
          <FileDown
            aria-hidden
            strokeWidth={1.5}
            className="size-[30px] shrink-0 text-tint"
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-heading text-xl leading-snug">
              Drop a PDF to send it
            </span>
            <span className="truncate text-[13px] text-muted-foreground">
              Your signer gets an email link in seconds
            </span>
            {fileName ? (
              <span className="truncate font-mono text-xs text-tint">
                {fileName}
              </span>
            ) : null}
          </span>
        </label>
        <Button
          type="button"
          className="h-11 bg-seal px-6 text-[15px] font-semibold text-bond hover:bg-seal/90"
          onClick={() => {
            setExpanded(true);
            fileRef.current?.click();
          }}
        >
          Choose a PDF
        </Button>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-4">
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
                className="h-11 text-base md:text-base"
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
                placeholder="you@example.com"
                className="h-11 text-base md:text-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="signer_name">Signer name</Label>
              <Input
                id="signer_name"
                name="signer_name"
                required
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Jane"
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
                value={signerEmail}
                onChange={(e) => setSignerEmail(e.target.value)}
                placeholder="jane@example.com"
                className="h-11 text-base md:text-base"
              />
            </div>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            className="h-11 w-full text-base sm:w-auto sm:self-start sm:px-8"
            type="submit"
            disabled={busy}
          >
            Send
          </Button>
        </div>
      ) : null}
    </form>
  );

  const otp = (
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
  );

  const sealed = done ? (
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
  ) : null;

  function scrollToHero() {
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  const hero = (
    <TwoReader
      human={
          <>
            <p className={EYEBROW}>For humans</p>
            <h1 className="font-heading text-4xl leading-[1.14] tracking-[-0.02em] text-pretty md:text-5xl">
              Easy signing for everything, by people and their{" "}
              <em>AI agents</em>
              <span className="text-seal">.</span>
            </h1>
            <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
              Drop a PDF or POST it. Your signer gets a link, and you get back a
              sealed file with an audit trail. No account to send and none to
              sign. We shred it after 7 days unless you keep it.
            </p>
            {done ? sealed : sent ? otp : sender}
            <div className="flex flex-wrap items-center gap-3">
              <a
                className="text-sm font-medium text-tint underline-offset-4 hover:underline"
                href="/llms.txt"
              >
                Connect your AI agent &rarr;
              </a>
              <span aria-hidden className="text-input">
                &middot;
              </span>
              <a
                className="text-sm font-medium text-tint underline-offset-4 hover:underline"
                href="/upgrade"
              >
                Bring your team &rarr;
              </a>
            </div>
          </>
        }
        machine={
          <TerminalPanel
            eyebrow="For agents & developers"
            address="POST /v1/envelopes"
            footer={
              <>
                <p className="text-[#7e97d8]">
                  Signing inside your own product, not ours.
                </p>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[#55688f]">
                  <span>REST + OpenAPI</span>
                  <span>
                    MCP: <code>send · status · attest · verify</code>
                  </span>
                  <span>self-host: SELF_HOST=1</span>
                </p>
              </>
            }
          >
            <pre className="overflow-x-auto whitespace-pre text-ledger">
              {curlFor({ title, senderEmail, signerName, signerEmail, fileName })}
            </pre>
            {envelopeId ? (
              <p className="text-[#7e97d8]">&gt; sent · id {envelopeId}</p>
            ) : null}
            <div className="h-px bg-[#22304a]" />
            <pre className="overflow-x-auto whitespace-pre text-ledger">
              {AGENT_BLOCK}
            </pre>
          </TerminalPanel>
        }
      />
  );

  return (
    <PageShell variant="public" width="full" showFooter={false}>
      <ScrollStory
        hero={hero}
        onChooseFile={() => {
          setExpanded(true);
          fileRef.current?.click();
          scrollToHero();
        }}
        onDropFiles={(files) => {
          if (!fileRef.current) return;
          fileRef.current.files = files;
          onFile(files[0]?.name ?? null);
          scrollToHero();
        }}
      />
    </PageShell>
  );
}
