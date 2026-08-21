"use client";

import { useRef, useState } from "react";
import { ByteRange } from "@/components/byte-range";
import { LinkButton } from "@/components/link-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

export type CeremonyAttested = {
  slug: string;
  email: string;
};

export type CeremonyState = {
  title: string;
  signerName: string;
  signerEmail?: string;
  sequentialWait: boolean;
  expiresAt: string;
  shredAt?: string;
  signed?: boolean;
  declined?: boolean;
  status?: string;
  display_name?: string | null;
  has_logo?: boolean;
  attested?: CeremonyAttested[];
};

export function CeremonyNotice({
  title,
  body,
  sealed = false,
}: {
  title: string;
  body?: string;
  sealed?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ByteRange sealed={sealed} />
      <Card>
        <CardHeader>
          <h1 className="font-heading text-2xl tracking-tight">{title}</h1>
          {body ? <CardDescription className="text-base">{body}</CardDescription> : null}
        </CardHeader>
      </Card>
    </div>
  );
}

export function SigningCeremony({
  token,
  state,
  consentText,
}: {
  token: string;
  state: CeremonyState;
  consentText: string;
}) {
  const [consented, setConsented] = useState(false);
  const [done, setDone] = useState(Boolean(state.signed));
  const [completed, setCompleted] = useState(state.status === "completed");
  const [declined, setDeclined] = useState(Boolean(state.declined));
  const [shredAt, setShredAt] = useState(state.shredAt);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  if (declined) {
    return <CeremonyNotice title="You declined to sign." />;
  }

  if (done) {
    const email = encodeURIComponent(state.signerEmail ?? "");
    const when = shredAt ?? state.shredAt ?? "";
    if (!completed) {
      return (
        <div className="flex flex-col gap-4">
          <ByteRange />
          <Card>
            <CardHeader>
              <CardTitle>Signed</CardTitle>
              <CardDescription>{state.title}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-base">You&apos;re done. Waiting on the next signer.</p>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        <ByteRange sealed />
        <Card>
          <CardHeader>
            <CardTitle>Signed</CardTitle>
            <CardDescription>{state.title}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-base">
              Download this. We delete it on {when}.
            </p>
            <LinkButton href={`/s/${token}/pdf`} className="h-11 w-full text-base">
              Download
            </LinkButton>
            <LinkButton
              href={`/s/${token}/pdf?kind=certificate`}
              variant="outline"
              className="h-11 w-full text-base"
            >
              Certificate
            </LinkButton>
            <LinkButton
              href={`/login?email=${email}&next=/envelopes`}
              variant="outline"
              className="h-11 w-full text-base"
            >
              Keep it in a cabinet
            </LinkButton>
          </CardContent>
        </Card>
      </div>
    );
  }

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const p = point(e);
    if (!canvas || !ctx || !p) return;
    drawing.current = true;
    canvas.setPointerCapture(e.pointerId);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const p = point(e);
    if (!ctx || !p) return;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = false;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  async function onFinish() {
    if (!consented) {
      setError("Consent is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const consentRes = await fetch(`/s/${token}/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      if (!consentRes.ok) {
        setError("Consent is required");
        return;
      }
      const canvas = canvasRef.current;
      const blob = await new Promise<Blob | null>((resolve) => {
        if (!canvas || typeof canvas.toBlob !== "function") {
          resolve(null);
          return;
        }
        canvas.toBlob((b) => resolve(b), "image/png");
      });
      const body = new FormData();
      body.set("png", blob ?? new Blob([], { type: "image/png" }), "sig.png");
      const signRes = await fetch(`/s/${token}/sign`, { method: "POST", body });
      if (!signRes.ok) {
        setError("Could not finish");
        return;
      }
      const json = (await signRes.json()) as { shred_at?: string; status?: string };
      if (json.shred_at) setShredAt(json.shred_at);
      if (json.status === "completed") setCompleted(true);
      setDone(true);
    } catch {
      setError("Could not finish");
    } finally {
      setBusy(false);
    }
  }

  async function onDecline() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/s/${token}/decline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError("Could not decline");
        return;
      }
      setDeclined(true);
    } catch {
      setError("Could not decline");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ByteRange />
      <Card>
        <CardHeader>
          {state.has_logo ? (
            <img
              src={`/s/${token}/logo`}
              alt={state.display_name ?? "Sender"}
              className="mb-2 max-h-16 w-auto"
            />
          ) : null}
          {state.display_name ? (
            <p className="text-base text-muted-foreground">{state.display_name}</p>
          ) : null}
          <CardTitle className="font-heading text-2xl tracking-tight">
            {state.title}
          </CardTitle>
          <CardDescription className="text-base">
            {state.signerName}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {(state.attested ?? []).map((party) => (
            <p key={`${party.slug}:${party.email}`} className="text-base">
              {party.slug} attested for {party.email}
            </p>
          ))}
          <label className="flex items-start gap-3 text-base leading-snug">
            <Checkbox
              className="mt-1 size-4"
              checked={consented}
              onCheckedChange={(value) => setConsented(value === true)}
            />
            <span>{consentText}</span>
          </label>
          <div className="rounded-md border border-border bg-card p-3">
            <p className="mb-2 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
              Sign here
            </p>
            <div className="relative">
              <canvas
                ref={canvasRef}
                width={320}
                height={160}
                className="h-40 w-full touch-none bg-muted/40"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
              <span className="pointer-events-none absolute inset-x-4 bottom-10 border-b border-foreground/35" />
            </div>
            <p className="mt-2 text-center font-heading text-sm tracking-tight">
              {state.signerName}
            </p>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            className="h-11 w-full text-base"
            type="button"
            disabled={busy}
            onClick={onFinish}
          >
            Finish
          </Button>
          <Button
            className="h-11 w-full text-base"
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={onDecline}
          >
            Decline
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
