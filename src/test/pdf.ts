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
