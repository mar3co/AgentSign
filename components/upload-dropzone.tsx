"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

const TEXT_FILE_RE = /\.(md|markdown|txt)$/i;
const DOCX_RE = /\.docx$/i;
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function isPdf(f: File): boolean {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

function isDocx(f: File): boolean {
  return f.type === DOCX_MIME || DOCX_RE.test(f.name);
}

/* Dropzone styled after shadcn studio's file-upload-02 block, but backed by a
   real form input so plain FormData submits keep working. Single file. */
export function UploadDropzone({
  id,
  name,
  accept,
  required = false,
  prompt = "Drag & Drop or Choose file to upload",
  hint,
  className,
  collapseWhenFilled = false,
  dropAnywhere = false,
  onFileChange,
  onTextFile,
  onUnsupported,
  ariaInvalid,
  ariaDescribedBy,
}: {
  id: string;
  name: string;
  accept: string;
  required?: boolean;
  prompt?: string;
  hint?: string;
  className?: string;
  /** Hide the drop target once a file is chosen, leaving only the file row. */
  collapseWhenFilled?: boolean;
  /** Accept drops anywhere on the page: dragging a file over the window
      lights up the drop target (and reveals it if collapsed). */
  dropAnywhere?: boolean;
  onFileChange?: (file: File | null) => void;
  /** When set, .md/.txt files are read client-side and handed here
      instead of staying in the file input. */
  onTextFile?: (file: { name: string; text: string }) => void;
  /** When set alongside onTextFile, anything that is not a PDF, text, or
      Word file is cleared from the input and reported here by name. */
  onUnsupported?: (name: string) => void;
  /** Wired onto the underlying file input so a validation message elsewhere
      on the page can be associated with it. */
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [receiving, setReceiving] = useState(false);

  const clearAndHandOff = (fn: () => void) => {
    if (inputRef.current) inputRef.current.value = "";
    setFile(null);
    fn();
  };

  const readInput = () => {
    const f = inputRef.current?.files?.[0] ?? null;
    if (f && onTextFile && (TEXT_FILE_RE.test(f.name) || f.type.startsWith("text/"))) {
      void f.text().then((text) => {
        clearAndHandOff(() => onTextFile({ name: f.name, text }));
      });
      return;
    }
    // DOCX stays a file upload; the server converts it to PDF on send.
    if (f && onUnsupported && !isPdf(f) && !isDocx(f)) {
      clearAndHandOff(() => onUnsupported(f.name));
      return;
    }
    setFile(f ? { name: f.name, size: f.size } : null);
    onFileChange?.(f);
  };

  // Keep the latest handler visible to the window listeners below without
  // re-registering them every render.
  const readInputRef = useRef(readInput);
  readInputRef.current = readInput;

  useEffect(() => {
    if (!dropAnywhere) return;
    let depth = 0;
    const hasFiles = (e: globalThis.DragEvent) =>
      e.dataTransfer?.types.includes("Files") ?? false;
    const onEnter = (e: globalThis.DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setReceiving(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setReceiving(false);
    };
    // Without preventDefault on dragover, the browser refuses the drop and
    // navigates to the file instead.
    const onOver = (e: globalThis.DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: globalThis.DragEvent) => {
      depth = 0;
      setReceiving(false);
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      if (!inputRef.current || !e.dataTransfer?.files.length) return;
      inputRef.current.files = e.dataTransfer.files;
      readInputRef.current();
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [dropAnywhere]);

  // form.reset() clears the native input; clear the file row with it.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setFile(null);
      onFileChange?.(null);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [onFileChange]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!inputRef.current || !e.dataTransfer.files?.length) return;
    inputRef.current.files = e.dataTransfer.files;
    readInput();
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        role="button"
        tabIndex={-1}
        onClick={() => inputRef.current?.click()}
        onDragEnter={() => setDragging(true)}
        onDragLeave={() => setDragging(false)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDrop={onDrop}
        data-dragging={dragging || receiving || undefined}
        className={cn(
          "border-input has-[input:focus]:border-ring has-[input:focus]:ring-ring/50 data-[dragging=true]:border-primary data-[dragging=true]:bg-accent/50 flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-dashed p-6 text-center transition-colors has-[input:focus]:ring-[3px]",
          collapseWhenFilled && file && !receiving && "hidden",
        )}
      >
        <input
          ref={inputRef}
          id={id}
          name={name}
          type="file"
          accept={accept}
          required={required}
          className="sr-only"
          aria-label={prompt}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          onChange={readInput}
        />
        <Upload aria-hidden className="size-8 stroke-1" />
        <p className="text-sm font-medium">
          {receiving ? "Drop your file here" : prompt}
        </p>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </div>

      {file ? (
        <div className="bg-muted flex items-center justify-between gap-2 rounded-lg p-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-accent flex size-10 shrink-0 items-center justify-center rounded">
              <FileText aria-hidden className="size-5" />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-muted-foreground text-sm">{formatBytes(file.size)}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="size-6 shrink-0 hover:bg-transparent"
            onClick={() => {
              if (inputRef.current) inputRef.current.value = "";
              setFile(null);
              onFileChange?.(null);
            }}
            aria-label="Remove file"
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
