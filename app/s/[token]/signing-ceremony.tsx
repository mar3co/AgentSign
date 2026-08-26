"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import type { DocumentField, FieldArea } from "@/src/lib/pdf/fields";

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
  id?: string;
  fields?: DocumentField[];
  values?: Record<string, string | boolean>;
  signing_mode?: string;
  completed_redirect_url?: string | null;
  embed_origin?: string | null;
};

type FieldValues = Record<string, string | boolean>;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildInitialValues(
  fields: DocumentField[],
  stored: FieldValues,
  signerName: string,
): FieldValues {
  const next: FieldValues = {};
  for (const field of fields) {
    const existing = stored[field.name];
    if (existing !== undefined) {
      next[field.name] = existing;
      continue;
    }
    if (field.default_value !== undefined) {
      next[field.name] = field.default_value;
      continue;
    }
    if (field.type === "date") next[field.name] = todayIso();
    else if (field.type === "name") next[field.name] = signerName;
    else if (field.type === "checkbox") next[field.name] = false;
    else if (field.type === "signature" || field.type === "initials") continue;
    else next[field.name] = "";
  }
  return next;
}

function requiredFieldsReady(
  fields: DocumentField[],
  values: FieldValues,
  sigBlobs: Record<string, Blob>,
): boolean {
  for (const field of fields) {
    if (!field.required || field.readonly) continue;
    if (field.type === "signature" || field.type === "initials") {
      if (!sigBlobs[field.name]) return false;
      continue;
    }
    if (field.type === "checkbox") {
      if (values[field.name] !== true) return false;
      continue;
    }
    const text = values[field.name];
    if (typeof text !== "string" || text.trim() === "") return false;
  }
  return true;
}

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
  const fields = state.fields ?? [];
  const hasFields = fields.length > 0;
  const [consented, setConsented] = useState(false);
  const [done, setDone] = useState(Boolean(state.signed));
  const [completed, setCompleted] = useState(state.status === "completed");
  const [declined, setDeclined] = useState(Boolean(state.declined));
  const [shredAt, setShredAt] = useState(state.shredAt);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<FieldValues>(() =>
    buildInitialValues(fields, state.values ?? {}, state.signerName),
  );
  const [sigBlobs, setSigBlobs] = useState<Record<string, Blob>>({});
  const [sigUrls, setSigUrls] = useState<Record<string, string>>({});
  const [drawingField, setDrawingField] = useState<string | null>(null);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!hasFields) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/s/${token}/preview`);
        if (!res.ok || cancelled) return;
        const bytes = new Uint8Array(await res.arrayBuffer());
        try {
          const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
          const doc = await (
            pdfjs.getDocument({
              data: bytes,
              disableWorker: true,
              isEvalSupported: false,
            } as Parameters<typeof pdfjs.getDocument>[0])
          ).promise;
          const images: string[] = [];
          for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const viewport = page.getViewport({ scale: 1.25 });
            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;
            images.push(canvas.toDataURL("image/png"));
          }
          if (!cancelled) setPageImages(images);
        } catch {
          // happy-dom / bad PDF: still render HTML field boxes
        }
      } catch {
        // preview fetch failed; boxes still work
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasFields, token]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(sigUrls)) URL.revokeObjectURL(url);
    };
  }, [sigUrls]);

  const canFinish = useMemo(() => {
    if (!consented || busy) return false;
    if (!hasFields) return true;
    return requiredFieldsReady(fields, values, sigBlobs);
  }, [busy, consented, fields, hasFields, sigBlobs, values]);

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
              href={`/login?email=${email}&next=/documents`}
              variant="outline"
              className="h-11 w-full text-base"
            >
              Keep it in your documents
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

  async function saveSignature() {
    if (!drawingField) return;
    const canvas = canvasRef.current;
    const blob = await new Promise<Blob | null>((resolve) => {
      if (!canvas || typeof canvas.toBlob !== "function") {
        resolve(new Blob([], { type: "image/png" }));
        return;
      }
      canvas.toBlob((b) => resolve(b ?? new Blob([], { type: "image/png" })), "image/png");
    });
    if (!blob) return;
    const name = drawingField;
    setSigBlobs((prev) => ({ ...prev, [name]: blob }));
    setSigUrls((prev) => {
      const next = { ...prev };
      if (next[name]) URL.revokeObjectURL(next[name]!);
      next[name] = URL.createObjectURL(blob);
      return next;
    });
    setDrawingField(null);
  }

  async function onFinish() {
    if (!consented) {
      setError("Consent is required");
      return;
    }
    if (hasFields && !requiredFieldsReady(fields, values, sigBlobs)) {
      setError("Fill required fields");
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

      const body = new FormData();
      if (hasFields) {
        const posted: FieldValues = {};
        for (const field of fields) {
          if (field.type === "signature" || field.type === "initials") continue;
          const v = values[field.name];
          if (v !== undefined) posted[field.name] = v;
        }
        body.set("values", JSON.stringify(posted));
        const signatureFields = fields.filter((f) => f.type === "signature");
        for (const field of fields) {
          if (field.type !== "signature" && field.type !== "initials") continue;
          const blob = sigBlobs[field.name];
          if (!blob) continue;
          body.set(`sig:${field.name}`, blob, `${field.name}.png`);
        }
        if (signatureFields.length === 1) {
          const only = signatureFields[0]!;
          const blob = sigBlobs[only.name];
          if (blob) body.set("png", blob, "sig.png");
        }
      } else {
        const canvas = canvasRef.current;
        const blob = await new Promise<Blob | null>((resolve) => {
          if (!canvas || typeof canvas.toBlob !== "function") {
            resolve(null);
            return;
          }
          canvas.toBlob((b) => resolve(b), "image/png");
        });
        body.set("png", blob ?? new Blob([], { type: "image/png" }), "sig.png");
      }

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

  function renderFieldControl(field: DocumentField) {
    if (field.readonly) {
      const shown =
        field.type === "checkbox"
          ? values[field.name] === true
            ? "Yes"
            : "No"
          : String(values[field.name] ?? field.default_value ?? "");
      return (
        <span className="block truncate px-1 text-xs text-foreground">{shown || field.name}</span>
      );
    }
    if (field.type === "signature" || field.type === "initials") {
      const url = sigUrls[field.name];
      return (
        <button
          type="button"
          className="flex h-full w-full min-h-11 min-w-11 items-center justify-center overflow-hidden bg-background/80 px-1 text-xs"
          onClick={() => setDrawingField(field.name)}
        >
          {url ? (
            <img src={url} alt={field.name} className="max-h-full max-w-full object-contain" />
          ) : (
            field.name
          )}
        </button>
      );
    }
    if (field.type === "checkbox") {
      return (
        <label className="flex h-full min-h-11 min-w-11 cursor-pointer items-center gap-2 bg-background/80 px-1">
          <Checkbox
            checked={values[field.name] === true}
            onCheckedChange={(value) =>
              setValues((prev) => ({ ...prev, [field.name]: value === true }))
            }
          />
          <span className="truncate text-xs">{field.name}</span>
        </label>
      );
    }
    const inputType = field.type === "date" ? "date" : "text";
    return (
      <Input
        aria-label={field.name}
        type={inputType}
        className="h-full min-h-11 min-w-11 bg-background/90 text-xs"
        value={String(values[field.name] ?? "")}
        onChange={(e) =>
          setValues((prev) => ({ ...prev, [field.name]: e.target.value }))
        }
      />
    );
  }

  function fieldBoxStyle(area: FieldArea): React.CSSProperties {
    return {
      left: `${area.x}%`,
      top: `${area.y}%`,
      width: `${area.w}%`,
      height: `${area.h}%`,
      minWidth: 44,
      minHeight: 44,
    };
  }

  function renderOverlayBoxes(page: number) {
    return fields.flatMap((field) =>
      field.areas
        .filter((area) => area.page === page)
        .map((area, idx) => (
          <div
            key={`${field.name}:${page}:${idx}`}
            className="absolute z-10 overflow-hidden rounded border border-primary/50 bg-background/60"
            style={fieldBoxStyle(area)}
          >
            {renderFieldControl(field)}
          </div>
        )),
    );
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

          {hasFields ? (
            <div className="flex flex-col gap-3">
              {pageImages.length > 0 ? (
                pageImages.map((src, i) => (
                  <div key={src} className="relative w-full overflow-hidden rounded-md border border-border">
                    <img src={src} alt={`Page ${i + 1}`} className="block w-full" />
                    {renderOverlayBoxes(i + 1)}
                  </div>
                ))
              ) : (
                <div className="relative min-h-[28rem] w-full overflow-hidden rounded-md border border-border bg-muted/30">
                  {fields.flatMap((field) =>
                    field.areas.map((area, idx) => (
                      <div
                        key={`${field.name}:${area.page}:${idx}`}
                        className="absolute z-10 overflow-hidden rounded border border-primary/50 bg-background/60"
                        style={fieldBoxStyle(area)}
                      >
                        {renderFieldControl(field)}
                      </div>
                    )),
                  )}
                </div>
              )}

              {drawingField ? (
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
                  <div className="mt-3 flex gap-2">
                    <Button
                      className="h-11 flex-1 text-base"
                      type="button"
                      onClick={saveSignature}
                    >
                      Save signature
                    </Button>
                    <Button
                      className="h-11 flex-1 text-base"
                      type="button"
                      variant="secondary"
                      onClick={() => setDrawingField(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
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
          )}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            className="h-11 w-full text-base"
            type="button"
            disabled={hasFields ? !canFinish : busy}
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
