"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import { serializeFields, type PlacedField } from "@/app/send/field-model";
import { SendForm, type Order, type SignerRow } from "@/app/send/send-form";

type Done = {
  key: string;
  signers: { email: string; sign_url: string | null }[];
};

function summaryLine(s: {
  title: string;
  signerCount: number;
  order: Order;
  fieldCount: number;
  hasMessage: boolean;
  pageCount: number | null;
}): string {
  const parts: string[] = [s.title];
  if (s.pageCount != null) {
    parts.push(`${s.pageCount} page${s.pageCount === 1 ? "" : "s"}`);
  }
  parts.push(
    s.signerCount === 1
      ? "1 signer"
      : `${s.signerCount} signers, ${
          s.order === "parallel" ? "all at once" : "in order"
        }`,
  );
  parts.push(
    s.fieldCount > 0
      ? `${s.fieldCount} field${s.fieldCount === 1 ? "" : "s"}`
      : "no placed fields — signers review and sign",
  );
  if (s.hasMessage) parts.push("message included");
  return parts.join(" · ");
}

export function SendClient() {
  const [senderEmail, setSenderEmail] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [signers, setSigners] = useState<SignerRow[]>([
    { name: "", email: "" },
  ]);
  const [placed, setPlaced] = useState<PlacedField[]>([]);
  const [order, setOrder] = useState<Order>("sequential");
  const [message, setMessage] = useState("");
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
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
        signers.map((s, i) => ({
          name: s.name.trim(),
          email: s.email.trim(),
          role: `Signer ${i + 1}`,
        })),
      ),
    );
    if (placed.length > 0) {
      data.set("fields", JSON.stringify(serializeFields(placed)));
    }
    if (order === "parallel") data.set("order", "parallel");
    try {
      const res = await fetch("/v1/documents", {
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
      setDocumentId(json.id);
    } catch {
      setError("Could not send.");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!documentId) return;
    setError(null);
    setBusy(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    try {
      const res = await fetch(`/v1/documents/${documentId}/otp`, {
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
          <LinkButton href="/documents">Open Documents</LinkButton>
          <LinkButton href="/send" variant="outline">
            Send another
          </LinkButton>
        </div>
      </div>
    );
  }

  if (documentId) {
    const summary = summaryLine({
      title,
      signerCount: signers.length,
      order,
      fieldCount: placed.length,
      hasMessage: message.trim().length > 0,
      pageCount,
    });
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
            <p className="text-xs text-muted-foreground">{summary}</p>
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
    <SendForm
      senderEmail={senderEmail}
      setSenderEmail={setSenderEmail}
      title={title}
      setTitle={setTitle}
      file={file}
      setFile={setFile}
      signers={signers}
      setSigners={setSigners}
      placed={placed}
      setPlaced={setPlaced}
      order={order}
      setOrder={setOrder}
      message={message}
      setMessage={setMessage}
      setPageCount={setPageCount}
      error={error}
      busy={busy}
      onSubmit={onSubmit}
    />
  );
}
