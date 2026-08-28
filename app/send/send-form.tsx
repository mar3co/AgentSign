"use client";

import { useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Textarea } from "@/components/ui/textarea";
import { UploadDropzone } from "@/components/upload-dropzone";
import { cn } from "@/lib/utils";
import { FieldOverlay } from "@/app/send/field-editor/overlay";
import { FieldPalette } from "@/app/send/field-editor/palette";
import {
  removeSignerFields,
  signerColor,
  type PlacedField,
} from "@/app/send/field-model";
import { patchesCoverTags, type PatchBox } from "@/app/send/patch-model";
import { PdfPreview } from "@/app/send/pdf-preview";
import type { DocumentField, FieldType } from "@/src/lib/pdf/fields";

export type SignerRow = { name: string; email: string };
export type Order = "sequential" | "parallel";
export type StepId = "document" | "signers" | "fields" | "review";

const MESSAGE_MAX = 1000;
export const SEND_FORM_ID = "send-form";

/** Just enough to mark a step complete; the server validates for real. */
export function emailish(v: string): boolean {
  return v.trim().includes("@");
}

export function summaryLine(s: {
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

function RailStep({
  index,
  title,
  open,
  done,
  optional = false,
  onToggle,
  children,
}: {
  index: number;
  title: string;
  open: boolean;
  done: boolean;
  optional?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-sidebar-border">
      <button
        type="button"
        aria-expanded={open}
        aria-label={title}
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-medium"
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
            done
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {done ? <Check className="size-3" /> : index}
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {optional && !done ? (
          <span className="text-xs font-normal text-muted-foreground">
            Optional
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-4 px-4 pb-5">{children}</div>
      ) : null}
    </section>
  );
}

function NextButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="self-start"
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function SendForm(props: {
  senderEmail: string;
  setSenderEmail: (v: string) => void;
  title: string;
  setTitle: (v: string) => void;
  file: File | null;
  onFileChange: (f: File | null) => void;
  signers: SignerRow[];
  setSigners: Dispatch<SetStateAction<SignerRow[]>>;
  placed: PlacedField[];
  setPlaced: Dispatch<SetStateAction<PlacedField[]>>;
  tagFields: DocumentField[];
  patches: PatchBox[];
  setPatches: Dispatch<SetStateAction<PatchBox[]>>;
  whiteoutActive: boolean;
  setWhiteoutActive: (v: boolean) => void;
  replaceNotice: string | null;
  order: Order;
  setOrder: (o: Order) => void;
  message: string;
  setMessage: (v: string) => void;
  pageCount: number | null;
  openStep: StepId | null;
  setOpenStep: (s: StepId | null) => void;
  onPagesRendered: (n: number) => void;
  onPreviewFailed: () => void;
  error: string | null;
  busy: boolean;
  previewPending: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const {
    senderEmail,
    setSenderEmail,
    title,
    setTitle,
    file,
    onFileChange,
    signers,
    setSigners,
    placed,
    setPlaced,
    tagFields,
    patches,
    setPatches,
    whiteoutActive,
    setWhiteoutActive,
    replaceNotice,
    order,
    setOrder,
    message,
    setMessage,
    pageCount,
    openStep,
    setOpenStep,
    onPagesRendered,
    onPreviewFailed,
    error,
    busy,
    previewPending,
    onSubmit,
  } = props;

  const [activeSigner, setActiveSigner] = useState(0);
  const [activeType, setActiveType] = useState<FieldType | null>(null);

  const documentDone =
    file !== null && title.trim().length > 0 && emailish(senderEmail);
  const signersDone =
    signers.length > 0 &&
    signers.every((s) => s.name.trim().length > 0 && emailish(s.email));
  const fieldsDone = placed.length > 0 || patches.length > 0;

  function toggleStep(id: StepId) {
    setOpenStep(openStep === id ? null : id);
  }

  function setSigner(i: number, patch: Partial<SignerRow>) {
    setSigners((prev) =>
      prev.map((row, j) => (j === i ? { ...row, ...patch } : row)),
    );
  }

  function removeSigner(i: number) {
    const count = placed.filter((f) => f.signerIndex === i).length;
    if (count > 0) {
      const ok = window.confirm(
        `Removing this signer also removes their ${count} placed field${count === 1 ? "" : "s"}.`,
      );
      if (!ok) return;
    }
    setSigners((prev) => prev.filter((_, j) => j !== i));
    setPlaced((prev) => removeSignerFields(prev, i));
    setActiveSigner((prev) => {
      const next = prev > i ? prev - 1 : prev;
      return Math.max(0, Math.min(next, signers.length - 2));
    });
  }

  const rail = (
    <>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3.5">
        <p className="text-sm font-semibold">Send for signature</p>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        <RailStep
          index={1}
          title="Document"
          open={openStep === "document"}
          done={documentDone}
          onToggle={() => toggleStep("document")}
        >
          {file ? null : (
            <p className="text-xs text-muted-foreground">
              Drop a PDF on the canvas to get started.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              form={SEND_FORM_ID}
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
              form={SEND_FORM_ID}
              required
              autoComplete="email"
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
            />
          </div>
          <NextButton
            label="Next: Signers"
            onClick={() => setOpenStep("signers")}
          />
        </RailStep>

        <RailStep
          index={2}
          title="Signers"
          open={openStep === "signers"}
          done={signersDone}
          onToggle={() => toggleStep("signers")}
        >
          {signers.length > 1 ? (
            <div
              role="radiogroup"
              aria-label="Signing order"
              className="flex flex-col gap-1"
            >
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="radio"
                  name="order_choice"
                  checked={order === "sequential"}
                  onChange={() => setOrder("sequential")}
                />
                In order listed
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="radio"
                  name="order_choice"
                  checked={order === "parallel"}
                  onChange={() => setOrder("parallel")}
                />
                All at once
              </label>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              They sign in the order listed.
            </p>
          )}

          {signers.map((row, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: signerColor(i) }}
                  />
                  Signer {i + 1}
                </p>
                {signers.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove signer ${i + 1}`}
                    onClick={() => removeSigner(i)}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`signer-name-${i}`}>
                  {signers.length > 1 ? `Signer ${i + 1} name` : "Signer name"}
                </Label>
                <Input
                  id={`signer-name-${i}`}
                  form={SEND_FORM_ID}
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
                  type="email"
                  form={SEND_FORM_ID}
                  required
                  autoComplete="off"
                  value={row.email}
                  onChange={(e) => setSigner(i, { email: e.target.value })}
                  placeholder="jane@example.com"
                />
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setSigners((prev) => [...prev, { name: "", email: "" }])
              }
            >
              <Plus />
              Add signer
            </Button>
            <NextButton
              label="Next: Fields"
              onClick={() => setOpenStep("fields")}
            />
          </div>
        </RailStep>

        <RailStep
          index={3}
          title="Fields"
          open={openStep === "fields"}
          done={fieldsDone}
          optional
          onToggle={() => toggleStep("fields")}
        >
          {file ? (
            <FieldPalette
              signers={signers}
              activeSigner={activeSigner}
              onSignerChange={setActiveSigner}
              activeType={activeType}
              onTypeChange={setActiveType}
              whiteoutActive={whiteoutActive}
              onWhiteoutChange={setWhiteoutActive}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Add a PDF first, then pick a field type and click the page to
              place it.
            </p>
          )}
          <NextButton
            label="Next: Review"
            onClick={() => setOpenStep("review")}
          />
        </RailStep>

        <RailStep
          index={4}
          title="Review & send"
          open={openStep === "review"}
          done={false}
          onToggle={() => toggleStep("review")}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="message">Message to signers (optional)</Label>
            <Textarea
              id="message"
              name="message"
              form={SEND_FORM_ID}
              maxLength={MESSAGE_MAX}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a note for your signers…"
            />
            <p className="text-right text-xs text-muted-foreground">
              {message.length}/{MESSAGE_MAX}
            </p>
          </div>
          {file ? (
            <p className="text-xs text-muted-foreground">
              {summaryLine({
                title: title.trim() || "Untitled",
                signerCount: signers.length,
                order,
                fieldCount: placed.length,
                hasMessage: message.trim().length > 0,
                pageCount,
                patchCount: patches.length,
              })}
            </p>
          ) : null}
        </RailStep>
      </SidebarContent>
      <SidebarFooter className="gap-3 border-t border-sidebar-border p-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          form={SEND_FORM_ID}
          type="submit"
          className="w-full"
          disabled={busy || previewPending}
        >
          Send
        </Button>
      </SidebarFooter>
    </>
  );

  return (
    <AppShell
      rail={rail}
      mobileBar={
        <Button
          form={SEND_FORM_ID}
          type="submit"
          className="flex-1"
          disabled={busy || previewPending}
        >
          Send
        </Button>
      }
    >
      <form
        id={SEND_FORM_ID}
        onSubmit={onSubmit}
        className="flex w-full flex-1 flex-col"
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4",
            !file && "justify-center",
          )}
        >
          <UploadDropzone
            id="file"
            name="file"
            accept="application/pdf,.pdf"
            required
            collapseWhenFilled
            prompt="Drag & Drop or Choose a PDF to upload"
            hint="Your signer gets an email link in seconds."
            onFileChange={onFileChange}
            className={file ? undefined : "mx-auto w-full max-w-xl"}
          />

          {replaceNotice ? (
            <Alert>
              <AlertDescription>{replaceNotice}</AlertDescription>
            </Alert>
          ) : null}

          {patchesCoverTags(patches, tagFields) ? (
            <Alert>
              <AlertDescription>
                A correction covers a tag field. Covering a tag hides the text
                but keeps the field, because fields come from the document
                text. To remove the field, delete the tag from the PDF itself.
              </AlertDescription>
            </Alert>
          ) : null}

          {file ? (
            <PdfPreview
              file={file}
              onPagesRendered={onPagesRendered}
              onRenderFailed={onPreviewFailed}
              overlay={(pageIndex) => (
                <FieldOverlay
                  pageIndex={pageIndex}
                  fields={placed}
                  tagFields={tagFields}
                  placing={
                    activeType
                      ? { signerIndex: activeSigner, type: activeType }
                      : null
                  }
                  onPlace={(f) => setPlaced((prev) => [...prev, f])}
                  onChange={(f) =>
                    setPlaced((prev) =>
                      prev.map((x) => (x.id === f.id ? f : x)),
                    )
                  }
                  onDelete={(id) =>
                    setPlaced((prev) => prev.filter((x) => x.id !== id))
                  }
                  patches={patches}
                  drawingPatch={whiteoutActive}
                  onPatchAdd={(p) => setPatches((prev) => [...prev, p])}
                  onPatchChange={(p) =>
                    setPatches((prev) =>
                      prev.map((x) => (x.id === p.id ? p : x)),
                    )
                  }
                  onPatchDelete={(id) =>
                    setPatches((prev) => prev.filter((x) => x.id !== id))
                  }
                />
              )}
            />
          ) : null}
        </div>
      </form>
    </AppShell>
  );
}
