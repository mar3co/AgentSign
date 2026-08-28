import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";

export async function minimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText("Repair authorization");
  return doc.save();
}

/** Decoded content streams of one page, joined, for asserting drawn operators. */
export async function decodedPageContents(
  bytes: Uint8Array,
  pageIndex = 0,
): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  return doc
    .getPage(pageIndex)
    .node.normalizedEntries()
    .Contents!.asArray()
    .map((ref) => doc.context.lookup(ref))
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"))
    .join("\n");
}

/** pdfjs forbids enumerable extras on Array.prototype (PGlite adds `.random`). */
async function hideEnumerableArrayExtras<T>(fn: () => Promise<T>): Promise<T> {
  const hidden: [string, PropertyDescriptor][] = [];
  for (const key of Object.keys(Array.prototype as unknown as Record<string, unknown>)) {
    const desc = Object.getOwnPropertyDescriptor(Array.prototype, key);
    if (!desc?.enumerable) continue;
    hidden.push([key, desc]);
    Object.defineProperty(Array.prototype, key, { ...desc, enumerable: false });
  }
  try {
    return await fn();
  } finally {
    for (const [key, desc] of hidden) {
      Object.defineProperty(Array.prototype, key, desc);
    }
  }
}

export type ExtractedItem = {
  str: string;
  fontName: string;
  x: number;
  page: number;
};

/** Per-item text with font and position. Test assertions only. */
export async function pdfTextItems(bytes: Uint8Array): Promise<ExtractedItem[]> {
  const pdfjs = await hideEnumerableArrayExtras(
    () => import("pdfjs-dist/legacy/build/pdf.mjs"),
  );
  const pdf = await hideEnumerableArrayExtras(() =>
    pdfjs.getDocument({
      data: bytes.slice(),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    } as Parameters<typeof pdfjs.getDocument>[0]).promise,
  );
  const items: ExtractedItem[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!("str" in item) || item.str.length === 0) continue;
      items.push({
        str: item.str,
        fontName: String(item.fontName ?? ""),
        x: item.transform[4] ?? 0,
        page: pageNum,
      });
    }
  }
  return items;
}

/** Extracted text per page, items joined with spaces. Test assertions only. */
export async function pdfPagesText(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await hideEnumerableArrayExtras(
    () => import("pdfjs-dist/legacy/build/pdf.mjs"),
  );
  const pdf = await hideEnumerableArrayExtras(() =>
    pdfjs.getDocument({
      data: bytes.slice(),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    } as Parameters<typeof pdfjs.getDocument>[0]).promise,
  );
  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter((s) => s.length > 0)
        .join(" ")
        .replace(/\s+/g, " "),
    );
  }
  return pages;
}
