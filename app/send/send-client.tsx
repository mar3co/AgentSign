"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
import { loadPdfjs } from "@/app/lib/load-pdfjs";
import {
  dropOutOfRangeFields,
  serializeFields,
  type PlacedField,
} from "@/app/send/field-model";
import {
  applyPatches,
  dropOutOfRangePatches,
  type PatchBox,
} from "@/app/send/patch-model";
import { SendForm, type Order, type SignerRow } from "@/app/send/send-form";
import type { DocumentField } from "@/src/lib/pdf/fields";

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
  patchCount: number;
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
  if (s.patchCount > 0) {
    parts.push(`${s.patchCount} correction${s.patchCount === 1 ? "" : "s"}`);
  }
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
  const [patches, setPatches] = useState<PatchBox[]>([]);
  const [whiteoutActive, setWhiteoutActive] = useState(false);
  const [tagFields, setTagFields] = useState<DocumentField[]>([]);
  const [order, setOrder] = useState<Order>("sequential");
  const [message, setMessage] = useState("");
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [replaceNotice, setReplaceNotice] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const placedRef = useRef(placed);
  placedRef.current = placed;
  const patchesRef = useRef(patches);
  patchesRef.current = patches;

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

  useEffect(() => {
    if (!file) {
      setTagFields([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await loadPdfjs();
        const { parsePdfTags } = await import("@/src/lib/pdf/tags");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = await parsePdfTags(bytes);
        if (!cancelled) setTagFields(parsed.fields);
      } catch {
        if (!cancelled) setTagFields([]); // tags preview is best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Replacing the file keeps signers, message, order, placed fields, and
  // patches — the old file isn't recoverable client-side, so there's no
  // confirm dialog, just this reset of file-derived state.
  const handleFileChange = useCallback((f: File | null) => {
    setReplaceNotice(null);
    setFile(f);
    if (!f) {
      setPlaced([]);
      setPatches([]);
      setPageCount(null);
    }
  }, []);

  // Stable identity (via refs) so PdfPreview's effect only re-runs when the
  // file itself changes, not on every render.
  const handlePagesRendered = useCallback((n: number) => {
    setPageCount(n);
    const currentPlaced = placedRef.current;
    const currentPatches = patchesRef.current;
    const keptFields = dropOutOfRangeFields(currentPlaced, n);
    const keptPatches = dropOutOfRangePatches(currentPatches, n);
    const removedFields = currentPlaced.length - keptFields.length;
    const removedPatches = currentPatches.length - keptPatches.length;
    if (removedFields > 0 || removedPatches > 0) {
      setPlaced(keptFields);
      setPatches(keptPatches);
      setReplaceNotice(
        `Removed ${removedFields} field${removedFields === 1 ? "" : "s"} and ${removedPatches} correction${removedPatches === 1 ? "" : "s"} that were on pages the new PDF doesn't have.`,
      );
    }
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
      if (patches.length > 0 && file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const burned = await applyPatches(bytes, patches);
        data.set(
          "file",
          new Blob([new Uint8Array(burned)], { type: "application/pdf" }),
          file.name,
        );
      }
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
      patchCount: patches.length,
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
      onFileChange={handleFileChange}
      signers={signers}
      setSigners={setSigners}
      placed={placed}
      setPlaced={setPlaced}
      tagFields={tagFields}
      patches={patches}
      setPatches={setPatches}
      whiteoutActive={whiteoutActive}
      setWhiteoutActive={setWhiteoutActive}
      replaceNotice={replaceNotice}
      order={order}
      setOrder={setOrder}
      message={message}
      setMessage={setMessage}
      onPagesRendered={handlePagesRendered}
      error={error}
      busy={busy}
      onSubmit={onSubmit}
    />
  );
}
