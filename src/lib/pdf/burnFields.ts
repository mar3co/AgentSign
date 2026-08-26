import {
  PDFDocument,
  StandardFonts,
  rgb,
  clip,
  endPath,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
} from "pdf-lib";
import {
  areaToPdfRect,
  type DocumentField,
} from "./fields.js";

export type BurnParty = {
  role: string;
  kind: "human" | "agent";
  name: string;
  email: string;
  signedAt: Date | null;
  values: Record<string, string | boolean>;
  pngs: Record<string, Uint8Array>;
};

function partyForRole(
  parties: BurnParty[],
  role: string,
): BurnParty | undefined {
  return parties.find((p) => p.role === role);
}

export async function burnFields(
  original: Uint8Array,
  input: { fields: DocumentField[]; parties: BurnParty[] },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const field of input.fields) {
    const party = partyForRole(input.parties, field.role);
    if (!party) continue;

    for (const area of field.areas) {
      const page = pages[area.page - 1];
      if (!page) continue;
      const { width: pageWidth, height: pageHeight } = page.getSize();
      const rect = areaToPdfRect(pageWidth, pageHeight, area);
      const { x, y, w, h } = rect;

      if (field.type === "signature" || field.type === "initials") {
        const png = party.pngs[field.name];
        if (!png || png.byteLength === 0) continue;
        const image = await doc.embedPng(png);
        const scale = Math.min(
          w / (image.width || 1),
          h / (image.height || 1),
        );
        const drawW = image.width * scale;
        const drawH = image.height * scale;
        page.drawImage(image, {
          x: x + (w - drawW) / 2,
          y: y + (h - drawH) / 2,
          width: drawW,
          height: drawH,
        });
        continue;
      }

      if (field.type === "checkbox") {
        const value = party.values[field.name];
        const checked = value === true || value === "true";
        if (!checked) continue;
        page.drawLine({
          start: { x, y },
          end: { x: x + w, y: y + h },
          thickness: 1.5,
          color: rgb(0, 0, 0),
        });
        page.drawLine({
          start: { x, y: y + h },
          end: { x: x + w, y },
          thickness: 1.5,
          color: rgb(0, 0, 0),
        });
        continue;
      }

      // text / date / name
      const raw = party.values[field.name];
      if (raw === undefined || raw === null) continue;
      const text = String(raw);
      if (!text) continue;
      const size = Math.min(h * 0.6, 12);
      const textHeight = font.heightAtSize(size);
      const textY = y + (h - textHeight) / 2;
      page.pushOperators(
        pushGraphicsState(),
        rectangle(x, y, w, h),
        clip(),
        endPath(),
      );
      page.drawText(text, {
        x,
        y: textY,
        size,
        font,
        color: rgb(0, 0, 0),
      });
      page.pushOperators(popGraphicsState());
    }
  }

  return doc.save({ useObjectStreams: false });
}
