import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import { areaToPdfRect } from "@/src/lib/pdf/fields";

export type PatchBox = {
  id: string; // client-only id
  page: number; // 1-based
  x: number;
  y: number;
  w: number;
  h: number; // percent of page
  text: string; // "" = whiteout only
  fontSize: number; // pt, default 11
};

let nextId = 0;
function localId(): string {
  nextId += 1;
  return `patch_${nextId}`;
}

export function makePatch(
  page: number,
  x: number,
  y: number,
  w: number,
  h: number,
): PatchBox {
  return clampPatch({
    id: localId(),
    page,
    x,
    y,
    w,
    h,
    text: "",
    fontSize: 11,
  });
}

export function clampPatch(p: PatchBox): PatchBox {
  const w = Math.min(p.w, 100);
  const h = Math.min(p.h, 100);
  return {
    ...p,
    w,
    h,
    x: Math.min(Math.max(p.x, 0), 100 - w),
    y: Math.min(Math.max(p.y, 0), 100 - h),
  };
}

export function dropOutOfRangePatches(
  patches: PatchBox[],
  pageCount: number,
): PatchBox[] {
  return patches.filter((p) => p.page >= 1 && p.page <= pageCount);
}

export async function applyPatches(
  bytes: Uint8Array,
  patches: PatchBox[],
): Promise<Uint8Array> {
  if (patches.length === 0) return bytes;

  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  let font: PDFFont | null = null;

  for (const patch of patches) {
    const page = pages[patch.page - 1];
    if (!page) continue;
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const rect = areaToPdfRect(pageWidth, pageHeight, patch);
    const { x, y, w, h } = rect;
    if (w <= 0 || h <= 0) continue;

    page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1) });

    if (patch.text) {
      if (!font) font = await doc.embedFont(StandardFonts.Helvetica);
      const textY = Math.max(y, y + (h - patch.fontSize) / 2);
      page.drawText(patch.text, {
        x: x + 2,
        y: textY,
        size: patch.fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
  }

  return doc.save();
}
