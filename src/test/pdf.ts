import { PDFDocument } from "pdf-lib";
export async function minimalPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText("Repair authorization");
  return doc.save();
}
