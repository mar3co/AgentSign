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
  onFileChange,
}: {
  id: string;
  name: string;
  accept: string;
  required?: boolean;
  prompt?: string;
  hint?: string;
  className?: string;
  onFileChange?: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const readInput = () => {
    const f = inputRef.current?.files?.[0] ?? null;
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
        className="border-input has-[input:focus]:border-ring has-[input:focus]:ring-ring/50 data-[dragging=true]:bg-accent/50 flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border border-dashed p-6 text-center transition-colors has-[input:focus]:ring-[3px]"
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
