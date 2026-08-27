"use client";

import { useEffect, useState, type ReactNode } from "react";

export type PreviewPage = { dataUrl: string; aspect: number }; // aspect = height/width

export function PdfPreview({
  file,
  overlay,
  onPagesRendered,
}: {
  file: File;
  overlay?: (pageIndex: number) => ReactNode;
  onPagesRendered?: (pageCount: number) => void;
}) {
  const [pages, setPages] = useState<PreviewPage[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPages(null);
    setFailed(false);
    (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const doc = await (
          pdfjs.getDocument({
            data: bytes,
            disableWorker: true,
            isEvalSupported: false,
          } as Parameters<typeof pdfjs.getDocument>[0])
        ).promise;
        const out: PreviewPage[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport, canvas } as never)
              .promise;
          }
          out.push({
            dataUrl: ctx ? canvas.toDataURL("image/png") : "",
            aspect: viewport.height / viewport.width,
          });
          if (cancelled) return;
        }
        if (!cancelled) {
          setPages(out);
          onPagesRendered?.(out.length);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, onPagesRendered]);

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        Preview unavailable. You can still send this PDF.
      </p>
    );
  }
  if (!pages) {
    return <p className="text-sm text-muted-foreground">Rendering preview…</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {pages.map((p, i) => (
        <div
          key={i}
          data-page={i + 1}
          className="relative w-full overflow-hidden rounded-md border bg-white"
          style={{ aspectRatio: `1 / ${p.aspect}` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.dataUrl}
            alt={`Page ${i + 1}`}
            className="w-full"
            draggable={false}
          />
          {overlay?.(i)}
        </div>
      ))}
    </div>
  );
}
