import {
  defaultRequired,
  type DocumentField,
  type FieldArea,
  type FieldType,
} from "./fields.js";
import {
  expandArea,
  groupRuns,
  locatePdfText,
  unionBox,
  type LocatedItem,
  type PageViewportLike,
} from "./textRuns.js";

/**
 * Heuristic detection of fillable blanks in plain (non-fillable) PDFs:
 * underscore runs like "Signature: ________" and bare keyword labels like
 * "Date:". Best-effort suggestions — callers should let the user adjust.
 */

const BLANK_RE = /_{4,}/g;
// A keyword label with nothing after the colon, e.g. "Signature:".
const LABEL_RE = /([a-z][a-z '()/-]{0,40})\s*:\s*$/i;

const MAX_CANDIDATES = 50;

// Percent-of-page sizes for boxes placed next to a bare label.
const LABEL_BOX_SIZES: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 22, h: 5 },
  initials: { w: 8, h: 5 },
  date: { w: 14, h: 3.5 },
  name: { w: 18, h: 3.5 },
  text: { w: 18, h: 3.5 },
  checkbox: { w: 3, h: 3 },
};

function classifyLabel(label: string): FieldType | null {
  const l = label.toLowerCase();
  if (/\bsign(ature|ed by|s? here)?\b/.test(l) || l === "x") return "signature";
  if (/\binitial(s|ed)?\b/.test(l)) return "initials";
  if (/\bdate[a-z]*\b/.test(l)) return "date";
  if (/\bname\b/.test(l)) return "name";
  return null;
}

function clampArea(area: FieldArea): FieldArea {
  const w = Math.min(area.w, 100);
  const h = Math.min(area.h, 100);
  return {
    ...area,
    w,
    h,
    x: Math.min(Math.max(area.x, 0), 100 - w),
    y: Math.min(Math.max(area.y, 0), 100 - h),
  };
}

type Span = { item: LocatedItem; start: number; end: number };
type Line = { text: string; spans: Span[] };

function lineOf(run: LocatedItem[]): Line {
  let text = "";
  const spans: Span[] = [];
  for (const it of run) {
    spans.push({ item: it, start: text.length, end: text.length + it.str.length });
    text += it.str;
  }
  return { text, spans };
}

/**
 * Box for a character range. Ranges inside a single text item are located by
 * linear interpolation across the item's width — approximate for proportional
 * fonts, but close enough for suggestion boxes.
 */
function charRangeBox(
  line: Line,
  start: number,
  end: number,
  viewport: PageViewportLike,
  page: number,
): FieldArea {
  const parts: LocatedItem[] = [];
  for (const span of line.spans) {
    const from = Math.max(start, span.start);
    const to = Math.min(end, span.end);
    if (from >= to) continue;
    const len = span.end - span.start;
    const x0 = span.item.x + span.item.w * ((from - span.start) / len);
    const x1 = span.item.x + span.item.w * ((to - span.start) / len);
    parts.push({ ...span.item, x: x0, w: x1 - x0 });
  }
  return unionBox(parts, viewport, page);
}

function detectOnLine(
  line: Line,
  viewport: PageViewportLike,
  page: number,
): { type: FieldType; area: FieldArea }[] {
  const found: { type: FieldType; area: FieldArea }[] = [];

  BLANK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastBlankEnd = 0;
  while ((m = BLANK_RE.exec(line.text)) !== null) {
    const before = line.text.slice(lastBlankEnd, m.index).trim();
    lastBlankEnd = m.index + m[0].length;
    const label = before.replace(/[:.]\s*$/, "").trim();
    const type = label ? (classifyLabel(label) ?? "text") : null;
    const blankArea = charRangeBox(
      line,
      m.index,
      m.index + m[0].length,
      viewport,
      page,
    );
    if (type === null) {
      // An unlabeled run that spans most of the page is a divider, not a blank.
      if (blankArea.w > 50) continue;
      found.push({ type: "text", area: blankArea });
      continue;
    }
    found.push({ type, area: blankArea });
  }
  if (found.length > 0) return found;

  // No underscores: a bare keyword label at the end of the line gets a
  // default-size box placed right after it.
  const label = LABEL_RE.exec(line.text.trimEnd());
  if (label) {
    const type = classifyLabel(label[1]!.trim());
    if (type) {
      const labelArea = charRangeBox(line, 0, line.text.length, viewport, page);
      const size = LABEL_BOX_SIZES[type];
      found.push({
        type,
        area: clampArea({
          page,
          x: labelArea.x + labelArea.w + 0.5,
          y: labelArea.y + labelArea.h - size.h,
          w: size.w,
          h: size.h,
        }),
      });
    }
  }
  return found;
}

/** Suggest fields for blanks found in the PDF's text. Throws `invalid_pdf`. */
export async function detectFieldCandidates(
  bytes: Uint8Array,
): Promise<DocumentField[]> {
  const located = await locatePdfText(bytes);
  const counts = new Map<FieldType, number>();
  const fields: DocumentField[] = [];

  for (const { page, viewport, items } of located) {
    for (const run of groupRuns(items)) {
      const line = lineOf(run);
      if (!line.text.trim()) continue;
      for (const { type, area } of detectOnLine(line, viewport, page)) {
        if (fields.length >= MAX_CANDIDATES) return fields;
        const n = (counts.get(type) ?? 0) + 1;
        counts.set(type, n);
        fields.push({
          name: `detected_${type}_${n}`,
          type,
          role: "Signer 1",
          required: defaultRequired(type),
          readonly: false,
          areas: [clampArea(expandArea(area, type))],
        });
      }
    }
  }
  return fields;
}
