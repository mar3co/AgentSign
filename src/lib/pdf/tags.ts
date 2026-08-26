import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import {
  areaToPdfRect,
  type DocumentField,
  type FieldArea,
  type FieldType,
  fieldTypes,
} from "./fields.js";

export type ParseTagsResult = { fields: DocumentField[]; pdf: Uint8Array };

export class InvalidFieldsError extends Error {
  code = "invalid_fields" as const;
  constructor(message = "invalid fields") {
    super(message);
    this.name = "InvalidFieldsError";
  }
}

const TAG_RE = /\{\{[^}]+\}\}/g;

const ALIAS_TYPES: Record<string, FieldType> = {
  sig: "signature",
  signature: "signature",
  initials: "initials",
  init: "initials",
  date: "date",
  name: "name",
};

const REQUIRED_BY_TYPE: Record<FieldType, boolean> = {
  signature: true,
  initials: true,
  date: true,
  name: true,
  text: false,
  checkbox: false,
};

const VALID_KEYS = new Set(["type", "role", "required", "readonly"]);
const FIELD_TYPES = new Set<string>(fieldTypes);

const Y_TOLERANCE = 2;
const GAP_FACTOR = 0.5;

type TextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type LocatedItem = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type TagMatch = {
  tag: string;
  body: string;
  area: FieldArea;
};

function toHex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    out += s.charCodeAt(i)!.toString(16).padStart(2, "0");
  }
  return out;
}

function fromLatin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

function toLatin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Replace tag glyphs in content streams so pdfjs can no longer extract them. */
function scrubTagsInContent(content: string, tags: string[]): string {
  let out = content;
  for (const tag of tags) {
    const hex = toHex(tag);
    const spaceHex = toHex(" ".repeat(tag.length));
    out = out.replace(new RegExp(`<${hex}>`, "gi"), `<${spaceHex}>`);
    out = out.split(`(${tag})`).join(`(${" ".repeat(tag.length)})`);
  }
  return out;
}

function scrubPageTags(
  doc: PDFDocument,
  pageIndex: number,
  tags: string[],
): void {
  if (tags.length === 0) return;
  const page = doc.getPages()[pageIndex];
  if (!page) return;
  const context = doc.context;
  const contents = page.node.get(PDFName.of("Contents"));
  if (!contents) return;

  const refs =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
      : [contents];

  const scrubbed = [];
  for (const ref of refs) {
    const stream = context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) {
      scrubbed.push(ref);
      continue;
    }
    const decoded = decodePDFRawStream(stream).decode();
    const next = scrubTagsInContent(fromLatin1(decoded), tags);
    scrubbed.push(context.register(context.flateStream(toLatin1(next))));
  }

  if (scrubbed.length === 1) {
    page.node.set(PDFName.of("Contents"), scrubbed[0]!);
  } else {
    page.node.set(PDFName.of("Contents"), context.obj(scrubbed));
  }
}

function itemBox(item: TextItem): LocatedItem {
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

function sameLine(a: LocatedItem, b: LocatedItem): boolean {
  return Math.abs(a.y - b.y) <= Y_TOLERANCE;
}

function adjacent(prev: LocatedItem, next: LocatedItem): boolean {
  const gap = next.x - (prev.x + prev.w);
  return gap <= Math.max(prev.h, next.h) * GAP_FACTOR;
}

function groupRuns(items: LocatedItem[]): LocatedItem[][] {
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

function unionBox(
  items: LocatedItem[],
  pageWidth: number,
  pageHeight: number,
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
  const wPts = Math.max(maxX - minX, 1);
  const hPts = Math.max(maxY - minY, 1);
  return {
    page,
    x: (minX / pageWidth) * 100,
    y: ((pageHeight - maxY) / pageHeight) * 100,
    w: (wPts / pageWidth) * 100,
    h: (hPts / pageHeight) * 100,
  };
}

function expandArea(area: FieldArea, type: FieldType): FieldArea {
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

function parseBody(body: string): Omit<DocumentField, "areas"> {
  const trimmed = body.trim();
  const parts = trimmed.split(";");
  const name = (parts[0] ?? "").trim();
  if (!name || name.length > 80 || name.includes("{") || name.includes("}")) {
    throw new InvalidFieldsError("invalid field name");
  }

  let type: FieldType | undefined;
  let role = "Signer 1";
  let required: boolean | undefined;
  let readonly = false;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) throw new InvalidFieldsError(`invalid field option: ${part}`);
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!VALID_KEYS.has(key)) {
      throw new InvalidFieldsError(`unknown field key: ${key}`);
    }
    if (key === "type") {
      if (!FIELD_TYPES.has(value)) {
        throw new InvalidFieldsError(`unknown field type: ${value}`);
      }
      type = value as FieldType;
    } else if (key === "role") {
      if (!value || value.length > 80) {
        throw new InvalidFieldsError("invalid role");
      }
      role = value;
    } else if (key === "required") {
      if (value !== "true" && value !== "false") {
        throw new InvalidFieldsError("invalid required");
      }
      required = value === "true";
    } else if (key === "readonly") {
      if (value !== "true" && value !== "false") {
        throw new InvalidFieldsError("invalid readonly");
      }
      readonly = value === "true";
    }
  }

  if (!type) {
    type = ALIAS_TYPES[name] ?? "text";
  }

  return {
    name,
    type,
    role,
    required: required ?? REQUIRED_BY_TYPE[type],
    readonly,
  };
}

function findTagsOnPage(
  items: LocatedItem[],
  pageWidth: number,
  pageHeight: number,
  page: number,
): TagMatch[] {
  const matches: TagMatch[] = [];
  for (const run of groupRuns(items)) {
    let line = "";
    const charItems: LocatedItem[] = [];
    for (const it of run) {
      for (let i = 0; i < it.str.length; i++) {
        line += it.str[i];
        charItems.push(it);
      }
    }
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(line)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const contributing = charItems.slice(start, end);
      const unique: LocatedItem[] = [];
      const seen = new Set<LocatedItem>();
      for (const c of contributing) {
        if (!seen.has(c)) {
          seen.add(c);
          unique.push(c);
        }
      }
      const tag = m[0];
      matches.push({
        tag,
        body: tag.slice(2, -2),
        area: unionBox(unique, pageWidth, pageHeight, page),
      });
    }
  }
  return matches;
}

async function loadPdfJs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/** pdfjs forbids enumerable extras on Array.prototype (PGlite/test DB adds `.random`). */
async function hideEnumerableArrayExtras<T>(fn: () => Promise<T>): Promise<T> {
  const hidden: [string, PropertyDescriptor][] = [];
  for (const key of Object.keys(Array.prototype as unknown as Record<string, unknown>)) {
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

export async function parsePdfTags(bytes: Uint8Array): Promise<ParseTagsResult> {
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

  const fields: DocumentField[] = [];
  const whiteoutAreas: FieldArea[] = [];
  const tagsByPage = new Map<number, string[]>();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;
    const content = await page.getTextContent();
    const located: LocatedItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string") continue;
      located.push(itemBox(raw as TextItem));
    }
    const tags = findTagsOnPage(located, pageWidth, pageHeight, pageNum);
    const pageTags: string[] = [];
    for (const tag of tags) {
      const parsed = parseBody(tag.body);
      const area = expandArea(tag.area, parsed.type);
      whiteoutAreas.push(tag.area);
      pageTags.push(tag.tag);
      fields.push({
        ...parsed,
        areas: [area],
      });
    }
    if (pageTags.length) tagsByPage.set(pageNum, pageTags);
  }

  if (fields.length === 0) {
    return { fields: [], pdf: bytes };
  }

  const doc = await PDFDocument.load(bytes);
  for (const [pageNum, tags] of tagsByPage) {
    scrubPageTags(doc, pageNum - 1, tags);
  }
  const pages = doc.getPages();
  for (const area of whiteoutAreas) {
    const page = pages[area.page - 1];
    if (!page) continue;
    const { width, height } = page.getSize();
    // Pad slightly so descenders/ascenders are covered visually.
    const padded = {
      ...area,
      x: Math.max(0, area.x - 0.3),
      y: Math.max(0, area.y - 0.3),
      w: Math.min(100 - Math.max(0, area.x - 0.3), area.w + 0.6),
      h: Math.min(100 - Math.max(0, area.y - 0.3), area.h + 0.6),
    };
    const rect = areaToPdfRect(width, height, padded);
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.w,
      height: rect.h,
      color: rgb(1, 1, 1),
      borderWidth: 0,
    });
  }

  return { fields, pdf: await doc.save() };
}
