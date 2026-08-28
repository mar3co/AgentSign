import { PDFDocument, PDFFont, StandardFonts, degrees, rgb } from "pdf-lib";
import {
  areaToDisplayRect,
  displayPointToPage,
  displayRectToPage,
  pageSpaceOf,
} from "@/src/lib/pdf/pageSpace";

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

/** A whiteout can't remove a tag field — the tag is detected from the
 * document's text, which stays extractable under a drawn rectangle. */
export function patchesCoverTags(
  patches: PatchBox[],
  tagFields: { areas: { page: number; x: number; y: number; w: number; h: number }[] }[],
): boolean {
  return patches.some((p) =>
    tagFields.some((f) =>
      f.areas.some(
        (a) =>
          a.page === p.page &&
          a.x < p.x + p.w &&
          a.x + a.w > p.x &&
          a.y < p.y + p.h &&
          a.y + a.h > p.y,
      ),
    ),
  );
}

export function dropOutOfRangePatches(
  patches: PatchBox[],
  pageCount: number,
): PatchBox[] {
  return patches.filter((p) => p.page >= 1 && p.page <= pageCount);
}

/** Correction text the standard Helvetica font cannot encode. */
export class PatchTextError extends Error {
  constructor(text: string) {
    super(`correction text cannot be printed: ${text}`);
    this.name = "PatchTextError";
  }
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
    const space = pageSpaceOf(page);
    const display = areaToDisplayRect(space, patch);
    if (display.w <= 0 || display.h <= 0) continue;
    const rect = displayRectToPage(space, display);

    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      color: rgb(1, 1, 1),
    });

    if (patch.text) {
      if (!font) font = await doc.embedFont(StandardFonts.Helvetica);
      const anchor = displayPointToPage(
        space,
        display.x + 2,
        Math.max(display.y, display.y + (display.h - patch.fontSize) / 2),
      );
      try {
        page.drawText(patch.text, {
          x: anchor.x,
          y: anchor.y,
          size: patch.fontSize,
          font,
          rotate: degrees(space.rotation),
          color: rgb(0.1, 0.1, 0.1),
        });
      } catch {
        throw new PatchTextError(patch.text);
      }
    }
  }

  return doc.save();
}
