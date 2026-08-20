"use client";

import { useState, type FormEvent } from "react";
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

const CURL_EXAMPLE = `curl -F title=Repair\\ authorization \\
     -F sender_email=shop@example.com \\
     -F signers='[{"name":"Jane","email":"jane@example.com"}]' \\
     -F file=@form.pdf \\
     http://localhost:3000/v1/envelopes`;

export default function Home() {
  const [sent, setSent] = useState(false);
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
      setSent(true);
    } catch {
      setError("Could not send.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <p className="text-base font-medium">Sign</p>
        <a className="text-sm text-muted-foreground underline" href="/login">
          Log in
        </a>
      </header>

      <main className="flex flex-1 flex-col gap-6">
        {sent ? (
          <Alert>
            <AlertDescription>Check your email for a code.</AlertDescription>
          </Alert>
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
                    className="h-11 text-base md:text-base"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="file">PDF</Label>
                  <Input
                    id="file"
                    name="file"
                    type="file"
                    accept="application/pdf,.pdf"
                    required
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
                  Send
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Or curl</h2>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">
            {CURL_EXAMPLE}
          </pre>
        </section>
      </main>

      <footer className="pb-4 text-center text-sm text-muted-foreground">
        Sign
      </footer>
    </div>
  );
}
