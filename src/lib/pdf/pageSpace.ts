import type { PDFPage } from "pdf-lib";
import { areaToPdfRect, type FieldArea } from "./fields.js";

/**
 * Field and patch areas are percent of the page *as displayed*: pdfjs
 * viewports honor /Rotate and use the CropBox. pdf-lib draws in raw
 * (unrotated) user space, so burning maps display coordinates back through
 * the rotation and the CropBox origin.
 */
export type PageSpace = {
  rotation: 0 | 90 | 180 | 270;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  displayW: number;
  displayH: number;
};

export type Rect = { x: number; y: number; w: number; h: number };

export function pageSpaceOf(page: PDFPage): PageSpace {
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const rotation =
    angle === 90 || angle === 180 || angle === 270 ? angle : 0;
  const crop = page.getCropBox();
  const sideways = rotation === 90 || rotation === 270;
  return {
    rotation,
    cropX: crop.x,
    cropY: crop.y,
    cropW: crop.width,
    cropH: crop.height,
    displayW: sideways ? crop.height : crop.width,
    displayH: sideways ? crop.width : crop.height,
  };
}

/**
 * Display-space point (origin at the bottom-left of the displayed page,
 * y up, in points) → PDF user space. Matches pdfjs convertToPdfPoint for
 * the page's default viewport.
 */
export function displayPointToPage(
  s: PageSpace,
  dx: number,
  dy: number,
): { x: number; y: number } {
  switch (s.rotation) {
    case 90:
      return { x: s.cropX + s.cropW - dy, y: s.cropY + dx };
    case 180:
      return { x: s.cropX + s.cropW - dx, y: s.cropY + s.cropH - dy };
    case 270:
      return { x: s.cropX + dy, y: s.cropY + s.cropH - dx };
    default:
      return { x: s.cropX + dx, y: s.cropY + dy };
  }
}

/** Percent area (top-left origin) → display rect in points (bottom-left origin), clamped to the page. */
export function areaToDisplayRect(s: PageSpace, area: FieldArea): Rect {
  return areaToPdfRect(s.displayW, s.displayH, area);
}

export function displayRectToPage(s: PageSpace, r: Rect): Rect {
  const a = displayPointToPage(s, r.x, r.y);
  const b = displayPointToPage(s, r.x + r.w, r.y + r.h);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function areaToPageRect(s: PageSpace, area: FieldArea): Rect {
  return displayRectToPage(s, areaToDisplayRect(s, area));
}
