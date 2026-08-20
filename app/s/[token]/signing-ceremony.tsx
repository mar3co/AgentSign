"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

export type CeremonyState = {
  title: string;
  signerName: string;
  signerEmail?: string;
  sequentialWait: boolean;
  expiresAt: string;
  shredAt?: string;
  signed?: boolean;
  declined?: boolean;
};

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
  const [declined, setDeclined] = useState(Boolean(state.declined));
  const [shredAt, setShredAt] = useState(state.shredAt);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  if (declined) {
    return (
      <main className="mx-auto max-w-md p-4">
        <p className="text-base">You declined to sign.</p>
      </main>
    );
  }

  if (done) {
    const email = encodeURIComponent(state.signerEmail ?? "");
    const when = shredAt ?? state.shredAt ?? "";
    return (
      <main className="mx-auto max-w-md p-4">
        <Card>
          <CardHeader>
            <CardTitle>Signed</CardTitle>
            <CardDescription>{state.title}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-base">
              Download this. We delete it on {when}.
            </p>
            <Button className="h-11 w-full text-base" type="button">
              Download
            </Button>
            <a
              className="text-base underline"
              href={`/login?email=${email}&next=/envelopes`}
            >
              Keep it in a cabinet
            </a>
          </CardContent>
        </Card>
      </main>
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
    const consentRes = await fetch(`/s/${token}/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent: true }),
    });
    if (!consentRes.ok) {
      setBusy(false);
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
    setBusy(false);
    if (!signRes.ok) {
      setError("Could not finish");
      return;
    }
    const json = (await signRes.json()) as { shred_at?: string };
    if (json.shred_at) setShredAt(json.shred_at);
    setDone(true);
  }

  async function onDecline() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/s/${token}/decline`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Could not decline");
      return;
    }
    setDeclined(true);
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{state.title}</CardTitle>
          <CardDescription className="text-base">
            {state.signerName}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-start gap-3 text-base leading-snug">
            <Checkbox
              className="mt-1 size-4"
              checked={consented}
              onCheckedChange={(value) => setConsented(value === true)}
            />
            <span>{consentText}</span>
          </label>
          <canvas
            ref={canvasRef}
            width={320}
            height={160}
            className="h-40 w-full touch-none rounded-md border border-border bg-white"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {error ? <p className="text-base text-destructive">{error}</p> : null}
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
    </main>
  );
}
