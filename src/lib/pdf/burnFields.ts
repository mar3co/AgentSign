import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  clip,
  endPath,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
} from "pdf-lib";
import { type DocumentField } from "./fields.js";
import {
  areaToDisplayRect,
  displayPointToPage,
  displayRectToPage,
  pageSpaceOf,
} from "./pageSpace.js";

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
  const roles = new Set<string>();
  for (const party of input.parties) {
    if (roles.has(party.role)) {
      throw new Error("Signer roles must be unique");
    }
    roles.add(party.role);
  }
  const doc = await PDFDocument.load(original);
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const field of input.fields) {
    const party = partyForRole(input.parties, field.role);
    if (!party) continue;

    for (const area of field.areas) {
      const page = pages[area.page - 1];
      if (!page) continue;
      const space = pageSpaceOf(page);
      // Sizes and anchors are computed in display space (how the sender and
      // signer saw the page), then mapped into raw user space to draw.
      const display = areaToDisplayRect(space, area);
      if (display.w <= 0 || display.h <= 0) continue;
      const rect = displayRectToPage(space, display);
      const { x, y, w, h } = rect;
      const rotate = degrees(space.rotation);

      if (field.type === "signature" || field.type === "initials") {
        const png = party.pngs[field.name];
        if (!png || png.byteLength === 0) continue;
        const image = await doc.embedPng(png);
        const scale = Math.min(
          display.w / (image.width || 1),
          display.h / (image.height || 1),
        );
        const drawW = image.width * scale;
        const drawH = image.height * scale;
        const anchor = displayPointToPage(
          space,
          display.x + (display.w - drawW) / 2,
          display.y + (display.h - drawH) / 2,
        );
        page.drawImage(image, {
          x: anchor.x,
          y: anchor.y,
          width: drawW,
          height: drawH,
          rotate,
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
      const size = Math.min(display.h * 0.6, 12);
      const textHeight = font.heightAtSize(size);
      // drawText's y is the baseline, so lift it by the descent to center
      // the glyph box, not the baseline, in the field.
      const descent = textHeight - font.heightAtSize(size, { descender: false });
      const anchor = displayPointToPage(
        space,
        display.x,
        display.y + (display.h - textHeight) / 2 + descent,
      );
      page.pushOperators(
        pushGraphicsState(),
        rectangle(x, y, w, h),
        clip(),
        endPath(),
      );
      page.drawText(text, {
        x: anchor.x,
        y: anchor.y,
        size,
        font,
        rotate,
        color: rgb(0, 0, 0),
      });
      page.pushOperators(popGraphicsState());
    }
  }

  return doc.save({ useObjectStreams: false });
}
