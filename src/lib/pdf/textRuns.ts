import type { FieldArea, FieldType } from "./fields.js";

/**
 * Shared text geometry for pdfjs-based extraction: turning text items into
 * located boxes, clustering them into lines, and mapping boxes to percent
 * areas through the page's default viewport (honoring /Rotate and CropBox).
 */

export const Y_TOLERANCE = 2;
export const GAP_FACTOR = 0.5;

export type TextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

export type LocatedItem = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PageViewportLike = {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
};

export function itemBox(item: TextItem): LocatedItem {
  const [a, , , d, e, f] = item.transform;
  const fontSize = Math.hypot(a, item.transform[1] ?? 0) || Math.abs(d) || 12;
  const h = item.height || fontSize;
  // transform[5] is baseline; use font size as approximate glyph box height above baseline.
  return {
    str: item.str,
    x: e,
    y: f,
    w: item.width || fontSize * item.str.length * 0.5,
    h,
  };
}

export function sameLine(a: LocatedItem, b: LocatedItem): boolean {
  return Math.abs(a.y - b.y) <= Y_TOLERANCE;
}

export function adjacent(prev: LocatedItem, next: LocatedItem): boolean {
  const gap = next.x - (prev.x + prev.w);
  return gap <= Math.max(prev.h, next.h) * GAP_FACTOR;
}

export function groupRuns(items: LocatedItem[]): LocatedItem[][] {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > Y_TOLERANCE) return b.y - a.y;
    return a.x - b.x;
  });
  const runs: LocatedItem[][] = [];
  let current: LocatedItem[] = [];
  for (const item of sorted) {
    if (item.str.length === 0) continue;
    const last = current[current.length - 1];
    if (!last) {
      current = [item];
      continue;
    }
    if (sameLine(last, item) && adjacent(last, item)) {
      current.push(item);
    } else {
      runs.push(current);
      current = [item];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

export function unionBox(
  items: LocatedItem[],
  viewport: PageViewportLike,
  page: number,
): FieldArea {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    minX = Math.min(minX, it.x);
    maxX = Math.max(maxX, it.x + it.w);
    // PDF y is baseline; glyph extends roughly [y, y+h]
    minY = Math.min(minY, it.y);
    maxY = Math.max(maxY, it.y + it.h);
  }
  // Text coordinates are unrotated user space; areas are percent of the
  // displayed page, so map the box through the page's default viewport
  // (which honors /Rotate and the CropBox).
  const corners = [
    viewport.convertToViewportPoint(minX, minY),
    viewport.convertToViewportPoint(minX, maxY),
    viewport.convertToViewportPoint(maxX, minY),
    viewport.convertToViewportPoint(maxX, maxY),
  ];
  const xs = corners.map((c) => c[0]!);
  const ys = corners.map((c) => c[1]!);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const wPts = Math.max(Math.max(...xs) - left, 1);
  const hPts = Math.max(Math.max(...ys) - top, 1);
  return {
    page,
    x: (left / viewport.width) * 100,
    y: (top / viewport.height) * 100,
    w: (wPts / viewport.width) * 100,
    h: (hPts / viewport.height) * 100,
  };
}

export function expandArea(area: FieldArea, type: FieldType): FieldArea {
  if (type !== "signature" && type !== "initials") return area;
  const minW = 15;
  const minH = 4;
  let { x, y, w, h } = area;
  if (w < minW) {
    const cx = x + w / 2;
    w = minW;
    x = cx - w / 2;
  }
  if (h < minH) {
    const cy = y + h / 2;
    h = minH;
    y = cy - h / 2;
  }
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + w > 100) x = Math.max(0, 100 - w);
  if (y + h > 100) y = Math.max(0, 100 - h);
  w = Math.min(w, 100 - x);
  h = Math.min(h, 100 - y);
  return { ...area, x, y, w, h };
}

export async function loadPdfJs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/** pdfjs forbids enumerable extras on Array.prototype (PGlite/test DB adds `.random`). */
export async function hideEnumerableArrayExtras<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const hidden: [string, PropertyDescriptor][] = [];
  for (const key of Object.keys(
    Array.prototype as unknown as Record<string, unknown>,
  )) {
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

export type LocatedPage = {
  page: number;
  viewport: PageViewportLike;
  items: LocatedItem[];
};

/** Load a PDF and return each page's located text items. Throws `invalid_pdf`. */
export async function locatePdfText(bytes: Uint8Array): Promise<LocatedPage[]> {
  const pdfjs = await hideEnumerableArrayExtras(() => loadPdfJs());
  let pdf;
  try {
    // pdfjs v6 types dropped disableWorker/isEvalSupported; still pass per plan.
    pdf = await hideEnumerableArrayExtras(() =>
      pdfjs.getDocument({
        data: bytes.slice(),
        disableWorker: true,
        isEvalSupported: false,
        useSystemFonts: true,
      } as Parameters<typeof pdfjs.getDocument>[0]).promise,
    );
  } catch (err) {
    const e = new Error("invalid_pdf");
    e.cause = err;
    throw e;
  }

  if (pdf.numPages === 0) {
    throw new Error("invalid_pdf");
  }

  const pages: LocatedPage[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const located: LocatedItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string") continue;
      located.push(itemBox(raw as TextItem));
    }
    pages.push({ page: pageNum, viewport, items: located });
  }
  return pages;
}
