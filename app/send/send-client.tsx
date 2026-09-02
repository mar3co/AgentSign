"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app-shell";
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
  placedFromDetected,
  serializeFields,
  type PlacedField,
} from "@/app/send/field-model";
import {
  applyPatches,
  dropOutOfRangePatches,
  PatchTextError,
  type PatchBox,
} from "@/app/send/patch-model";
import {
  firstHeadingTitle,
  SendForm,
  summaryLine,
  titleFromFilename,
  validEmail,
  type FieldError,
  type Order,
  type SignerRow,
  type StepId,
} from "@/app/send/send-form";
import type { DocumentField } from "@/src/lib/pdf/fields";

type Done = {
  key: string;
  signers: { email: string; sign_url: string | null }[];
};

export function SendClient({ aiDetect = false }: { aiDetect?: boolean }) {
  const [senderEmail, setSenderEmail] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"upload" | "write">("upload");
  const [markdown, setMarkdown] = useState("");
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
  const [openStep, setOpenStep] = useState<StepId | null>("document");
  // False from the moment a file is chosen until its preview renders or
  // fails; submitting before then would burn patches against pages the
  // out-of-range cleanup hasn't seen yet.
  const [previewSettled, setPreviewSettled] = useState(true);
  const [replaceNotice, setReplaceNotice] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const [busy, setBusy] = useState(false);

  const placedRef = useRef(placed);
  placedRef.current = placed;
  const patchesRef = useRef(patches);
  patchesRef.current = patches;
  const fileRef = useRef(file);
  fileRef.current = file;
  // Tracks the last title we auto-filled, so a later auto-fill only
  // overwrites it if the user hasn't typed a title of their own since.
  const autoTitleRef = useRef("");

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
        const { extractAcroFields } = await import("@/src/lib/pdf/acroform");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = await parsePdfTags(bytes);
        // The server imports fillable-form fields on upload, bound to the
        // first human signer's role — "Signer 1" for documents sent from
        // this editor; preview them alongside tag fields so the editor
        // shows what gets created.
        const acro = await extractAcroFields(bytes).catch(() => []);
        if (cancelled) return;
        setTagFields([...parsed.fields, ...acro]);

        // Plain PDFs without tags or a fillable form: suggest fields for
        // blanks like "Signature: ____" as editable placed fields.
        if (parsed.fields.length === 0 && acro.length === 0) {
          const { detectFieldCandidates } = await import("@/src/lib/pdf/detect");
          const detected = placedFromDetected(await detectFieldCandidates(bytes));
          if (!cancelled && detected.length > 0) {
            setPlaced((prev) => [
              ...prev.filter((p) => !p.suggested),
              ...detected,
            ]);
            setReplaceNotice(
              `Suggested ${detected.length} field${detected.length === 1 ? "" : "s"} from blanks found in the document. Move or delete any that are wrong.`,
            );
          }
        }
      } catch {
        if (!cancelled) setTagFields([]); // tags preview is best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Replacing the file keeps signers, message, order, hand-placed fields,
  // and patches — the old file isn't recoverable client-side, so there's no
  // confirm dialog, just this reset of file-derived state. Suggestions were
  // detected from the old file's content, so they don't carry over.
  const handleFileChange = useCallback((f: File | null) => {
    setReplaceNotice(null);
    setFile(f);
    setPreviewSettled(!f);
    if (!f) {
      setPlaced([]);
      setPatches([]);
      setPageCount(null);
    } else {
      setPlaced((prev) => prev.filter((p) => !p.suggested));
      // Only take over the title if it's empty or still the value we
      // auto-filled last time — never overwrite something the user typed.
      setTitle((prev) => {
        if (prev.trim() !== "" && prev !== autoTitleRef.current) return prev;
        const auto = titleFromFilename(f.name);
        autoTitleRef.current = auto;
        return auto;
      });
    }
  }, []);

  // Same auto-title behavior for the "write instead" markdown mode: use the
  // first "# heading" line if there is one, otherwise leave the title blank.
  const handleMarkdownChange = useCallback((v: string) => {
    setMarkdown(v);
    setTitle((prev) => {
      if (prev.trim() !== "" && prev !== autoTitleRef.current) return prev;
      const auto = firstHeadingTitle(v);
      // No heading yet — leave whatever title is there (blank, or an
      // auto-fill from a previous file/heading) rather than blanking it.
      if (!auto) return prev;
      autoTitleRef.current = auto;
      return auto;
    });
  }, []);

  // Stable identity (via refs) so PdfPreview's effect only re-runs when the
  // file itself changes, not on every render.
  const handlePagesRendered = useCallback((n: number) => {
    setPreviewSettled(true);
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

  // Without a preview there is no way to see or edit placed fields and
  // patches, so they can't be trusted against this file — drop them.
  const handlePreviewFailed = useCallback(() => {
    setPreviewSettled(true);
    setPageCount(null);
    if (placedRef.current.length > 0 || patchesRef.current.length > 0) {
      setPlaced([]);
      setPatches([]);
      setReplaceNotice(
        "The preview could not be rendered, so placed fields and corrections were removed. You can still send this file as-is.",
      );
    }
  }, []);

  // Inputs in collapsed steps are unmounted, so native validation can't
  // reach them; this checks state directly and names exactly what's missing
  // so onSubmit can reopen the right step.
  function validateSend(): FieldError | null {
    const hasDocument =
      mode === "write" ? markdown.trim().length > 0 : file !== null;
    if (!hasDocument) {
      return { field: "document", message: "Add a document to send." };
    }
    if (title.trim().length === 0) {
      return { field: "title", message: "Give the document a title." };
    }
    if (!senderEmail?.trim()) {
      return { field: "senderEmail", message: "Enter your sender email." };
    }
    if (!validEmail(senderEmail)) {
      return {
        field: "senderEmail",
        message: "That sender email is not valid.",
      };
    }
    if (signers.length === 0) {
      return { field: "signerName", message: "Add at least one signer." };
    }
    for (let i = 0; i < signers.length; i++) {
      const s = signers[i]!;
      if (s.name.trim().length === 0) {
        return {
          field: "signerName",
          index: i,
          message: `Signer ${i + 1} needs a name.`,
        };
      }
      if (!s.email.trim()) {
        return {
          field: "signerEmail",
          index: i,
          message: `Signer ${i + 1} needs an email.`,
        };
      }
      if (!validEmail(s.email)) {
        return {
          field: "signerEmail",
          index: i,
          message: `Signer ${i + 1}'s email is not valid.`,
        };
      }
    }
    return null;
  }

  // Live-clears the error once the flagged field is fixed (or removed),
  // instead of waiting for the next submit attempt.
  useEffect(() => {
    if (!fieldError) return;
    const now = validateSend();
    if (!now || now.field !== fieldError.field || now.index !== fieldError.index) {
      setError(null);
      setFieldError(null);
    } else if (now.message !== fieldError.message) {
      // Same field, but the failure kind changed (e.g. "not valid" ->
      // cleared to empty) — show the fresh message instead of the stale one.
      setError(now.message);
      setFieldError(now);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, senderEmail, file, markdown, mode, signers, fieldError]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    const invalid = validateSend();
    if (invalid) {
      setOpenStep(
        invalid.field === "signerName" || invalid.field === "signerEmail"
          ? "signers"
          : "document",
      );
      setError(invalid.message);
      setFieldError(invalid);
      return;
    }
    setBusy(true);
    // Everything is controlled state, so build the payload from state rather
    // than the DOM; collapsed steps then can't drop values.
    const data = new FormData();
    data.set("title", title);
    data.set("sender_email", senderEmail ?? "");
    data.set("message", message);
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
      if (mode === "write") {
        data.set("markdown", markdown);
      } else if (patches.length > 0) {
        const bytes = new Uint8Array(await file!.arrayBuffer());
        const burned = await applyPatches(bytes, patches);
        data.set(
          "file",
          new Blob([new Uint8Array(burned)], { type: "application/pdf" }),
          file!.name,
        );
      } else {
        data.set("file", file!, file!.name);
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
      const json = (await res.json()) as {
        id?: string;
        status?: string;
        key?: string;
        signers?: { email: string; sign_url: string | null }[];
      };
      if (!json.id) {
        setError("Could not send.");
        return;
      }
      if (json.status === "pending") {
        // Confirmation is off for this sender: the document went out
        // directly, so skip the code screen.
        setDone({ key: json.key ?? "", signers: json.signers ?? [] });
        return;
      }
      setDocumentId(json.id);
    } catch (err) {
      setError(
        err instanceof PatchTextError
          ? "A correction contains characters that can't be printed. Edit its text and try again."
          : "Could not send.",
      );
    } finally {
      setBusy(false);
    }
  }

  const [aiBusy, setAiBusy] = useState(false);
  const handleAiDetect = useCallback(async () => {
    const f = file;
    if (!f || aiBusy) return;
    // The detect endpoint is PDF-only; DOCX uploads convert on the server
    // only when the document is sent.
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
      setError("AI field detection works on PDFs. DOCX files are converted when you send.");
      return;
    }
    setAiBusy(true);
    setError(null);
    try {
      const data = new FormData();
      data.set("file", f, f.name);
      const res = await fetch("/v1/detect-fields", {
        method: "POST",
        credentials: "include",
        body: data,
      });
      // The file may have been replaced while the model ran; errors and
      // suggestions both belong to the old document.
      if (fileRef.current !== f) return;
      if (!res.ok) {
        // 404 means the flag flipped off after this page loaded.
        if (res.status === 404) {
          setError("AI detection is not available right now.");
          return;
        }
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "Could not detect fields.");
        return;
      }
      const json = (await res.json()) as { fields?: DocumentField[] };
      const detected = placedFromDetected(json.fields ?? []);
      if (detected.length === 0) {
        setReplaceNotice("No fields were detected in this document.");
        return;
      }
      // Replace earlier suggestions (heuristic or a previous AI run) so a
      // second click doesn't stack duplicates; hand-placed fields stay.
      setPlaced((prev) => [...prev.filter((p) => !p.suggested), ...detected]);
      setReplaceNotice(
        `Added ${detected.length} AI-suggested field${detected.length === 1 ? "" : "s"}. Move or delete any that are wrong.`,
      );
    } catch {
      setError("Could not detect fields.");
    } finally {
      setAiBusy(false);
    }
  }, [file, aiBusy]);

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
    return (
      <AppShell widthClassName="max-w-3xl">
        <LoadingList />
      </AppShell>
    );
  }

  if (done) {
    const first = done.signers.find((s) => s.sign_url);
    return (
      <AppShell widthClassName="max-w-3xl">
        <div className="flex flex-col gap-4">
        <Alert>
          <AlertDescription className="flex flex-col gap-2">
            <p>
              Sent.{" "}
              {first
                ? `${first.email} has their signing link.`
                : "Your signers get their links in order."}
            </p>
            {done.key ? (
              <>
                <p>Keep this key; it is shown once.</p>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs">
                  {done.key}
                </pre>
              </>
            ) : null}
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
      </AppShell>
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
      <AppShell widthClassName="max-w-3xl">
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
      </AppShell>
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
      mode={mode}
      setMode={setMode}
      markdown={markdown}
      setMarkdown={handleMarkdownChange}
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
      pageCount={pageCount}
      openStep={openStep}
      setOpenStep={setOpenStep}
      onPagesRendered={handlePagesRendered}
      onPreviewFailed={handlePreviewFailed}
      error={error}
      fieldError={fieldError}
      busy={busy}
      previewPending={file !== null && !previewSettled}
      onSubmit={onSubmit}
      aiDetect={aiDetect}
      aiBusy={aiBusy}
      onAiDetect={handleAiDetect}
    />
  );
}
