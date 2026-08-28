"use client";

import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { UploadDropzone } from "@/components/upload-dropzone";
import { FieldOverlay } from "@/app/send/field-editor/overlay";
import { FieldPalette } from "@/app/send/field-editor/palette";
import { removeSignerFields, type PlacedField } from "@/app/send/field-model";
import { patchesCoverTags, type PatchBox } from "@/app/send/patch-model";
import { PdfPreview } from "@/app/send/pdf-preview";
import type { DocumentField, FieldType } from "@/src/lib/pdf/fields";

export type SignerRow = { name: string; email: string };
export type Order = "sequential" | "parallel";

const MESSAGE_MAX = 1000;

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
    onPagesRendered,
    onPreviewFailed,
    error,
    busy,
    previewPending,
    onSubmit,
  } = props;

  const [activeSigner, setActiveSigner] = useState(0);
  const [activeType, setActiveType] = useState<FieldType | null>(null);

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

  const formFields = (
    <>
      <UploadDropzone
        id="file"
        name="file"
        accept="application/pdf,.pdf"
        required
        prompt="Drag & Drop or Choose a PDF to upload"
        hint="Your signer gets an email link in seconds."
        onFileChange={onFileChange}
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
            but keeps the field, because fields come from the document text.
            To remove the field, delete the tag from the PDF itself.
          </AlertDescription>
        </Alert>
      ) : null}

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
          />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Signers</h3>
        {signers.length > 1 ? (
          <div
            role="radiogroup"
            aria-label="Signing order"
            className="flex flex-col gap-1 pt-1"
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
      </div>

      {signers.map((row, i) => (
        <div
          key={i}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`signer-name-${i}`}>
              {signers.length > 1 ? `Signer ${i + 1} name` : "Signer name"}
            </Label>
            <Input
              id={`signer-name-${i}`}
              name="signer_name"
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
              name="signer_email"
              type="email"
              required
              autoComplete="off"
              value={row.email}
              onChange={(e) => setSigner(i, { email: e.target.value })}
              placeholder="jane@example.com"
            />
          </div>
          {signers.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove signer ${i + 1}`}
              onClick={() => removeSigner(i)}
            >
              <X />
            </Button>
          ) : null}
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() =>
          setSigners((prev) => [...prev, { name: "", email: "" }])
        }
      >
        <Plus />
        Add signer
      </Button>

      <div className="flex flex-col gap-2">
        <Label htmlFor="message">Message to signers (optional)</Label>
        <Textarea
          id="message"
          name="message"
          maxLength={MESSAGE_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Add a note for your signers…"
        />
        <p className="text-right text-xs text-muted-foreground">
          {message.length}/{MESSAGE_MAX}
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        className="self-start px-8"
        type="submit"
        disabled={busy || previewPending}
      >
        Send
      </Button>
    </>
  );

  return (
    <form onSubmit={onSubmit}>
      <div
        className={
          file
            ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]"
            : "flex flex-col gap-6"
        }
      >
        {file ? (
          <div key="preview" className="flex flex-col gap-4">
            <FieldPalette
              signers={signers}
              activeSigner={activeSigner}
              onSignerChange={setActiveSigner}
              activeType={activeType}
              onTypeChange={setActiveType}
              whiteoutActive={whiteoutActive}
              onWhiteoutChange={setWhiteoutActive}
            />
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
          </div>
        ) : null}
        <Card
          key="form"
          className={file ? "lg:sticky lg:top-6 self-start" : undefined}
        >
          <CardContent className="flex flex-col gap-6">
            {formFields}
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
