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
  onFileChange,
  onTextFile,
  onUnsupported,
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
  onFileChange?: (file: File | null) => void;
  /** When set, .md/.txt files are read client-side (and .docx converted
      to markdown) and handed here instead of staying in the file input. */
  onTextFile?: (file: { name: string; text: string }) => void;
  /** When set alongside onTextFile, anything that is not a PDF, text, or
      Word file is cleared from the input and reported here by name. */
  onUnsupported?: (name: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);

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
    if (f && onTextFile && (DOCX_RE.test(f.name) || f.type === DOCX_MIME)) {
      void (async () => {
        try {
          const mammoth = await import("mammoth/mammoth.browser");
          const { value } = await mammoth.convertToMarkdown({
            arrayBuffer: await f.arrayBuffer(),
          });
          clearAndHandOff(() => onTextFile({ name: f.name, text: value }));
        } catch {
          clearAndHandOff(() => onUnsupported?.(f.name));
        }
      })();
      return;
    }
    if (f && onUnsupported && !isPdf(f)) {
      clearAndHandOff(() => onUnsupported(f.name));
      return;
    }
    setFile(f ? { name: f.name, size: f.size } : null);
    onFileChange?.(f);
  };

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
        data-dragging={dragging || undefined}
        className={cn(
          "border-input has-[input:focus]:border-ring has-[input:focus]:ring-ring/50 data-[dragging=true]:bg-accent/50 flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-dashed p-6 text-center transition-colors has-[input:focus]:ring-[3px]",
          collapseWhenFilled && file && "hidden",
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
          onChange={readInput}
        />
        <Upload aria-hidden className="size-8 stroke-1" />
        <p className="text-sm font-medium">{prompt}</p>
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
