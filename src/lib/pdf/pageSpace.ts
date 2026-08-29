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
  // pdfjs displays the CropBox intersected with the MediaBox, falling back
  // to the MediaBox when they don't overlap, so measure that same box.
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x1 = Math.max(crop.x, media.x);
  const y1 = Math.max(crop.y, media.y);
  const x2 = Math.min(crop.x + crop.width, media.x + media.width);
  const y2 = Math.min(crop.y + crop.height, media.y + media.height);
  const box =
    x2 > x1 && y2 > y1
      ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
      : media;
  const sideways = rotation === 90 || rotation === 270;
  return {
    rotation,
    cropX: box.x,
    cropY: box.y,
    cropW: box.width,
    cropH: box.height,
    displayW: sideways ? box.height : box.width,
    displayH: sideways ? box.width : box.height,
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

/** PDF user-space point → display-space point (inverse of displayPointToPage). */
export function pagePointToDisplay(
  s: PageSpace,
  x: number,
  y: number,
): { x: number; y: number } {
  switch (s.rotation) {
    case 90:
      return { x: y - s.cropY, y: s.cropX + s.cropW - x };
    case 180:
      return { x: s.cropX + s.cropW - x, y: s.cropY + s.cropH - y };
    case 270:
      return { x: s.cropY + s.cropH - y, y: x - s.cropX };
    default:
      return { x: x - s.cropX, y: y - s.cropY };
  }
}

/** PDF user-space rect → percent area (top-left origin) on the displayed page. */
export function pageRectToArea(
  s: PageSpace,
  r: Rect,
  page: number,
): FieldArea {
  const a = pagePointToDisplay(s, r.x, r.y);
  const b = pagePointToDisplay(s, r.x + r.w, r.y + r.h);
  const left = Math.min(a.x, b.x);
  const bottom = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  return {
    page,
    x: (left / s.displayW) * 100,
    y: ((s.displayH - (bottom + h)) / s.displayH) * 100,
    w: (w / s.displayW) * 100,
    h: (h / s.displayH) * 100,
  };
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
