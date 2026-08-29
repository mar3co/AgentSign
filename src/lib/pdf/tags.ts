import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import {
  type DocumentField,
  type FieldArea,
  type FieldType,
  fieldTypes,
} from "./fields.js";
import { areaToPageRect, pageSpaceOf } from "./pageSpace.js";
import {
  expandArea,
  groupRuns,
  locatePdfText,
  unionBox,
  type LocatedItem,
  type PageViewportLike,
} from "./textRuns.js";

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
  viewport: PageViewportLike,
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
      // Monospace text is code shown literally, never a live tag.
      if (contributing.some((c) => c.mono)) continue;
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
        area: unionBox(unique, viewport, page),
      });
    }
  }
  return matches;
}

export async function parsePdfTags(bytes: Uint8Array): Promise<ParseTagsResult> {
  const located = await locatePdfText(bytes);

  const fields: DocumentField[] = [];
  const whiteoutAreas: FieldArea[] = [];
  const tagsByPage = new Map<number, string[]>();

  for (const { page: pageNum, viewport, items } of located) {
    const tags = findTagsOnPage(items, viewport, pageNum);
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
    // Pad slightly so descenders/ascenders are covered visually.
    const padded = {
      ...area,
      x: Math.max(0, area.x - 0.3),
      y: Math.max(0, area.y - 0.3),
      w: Math.min(100 - Math.max(0, area.x - 0.3), area.w + 0.6),
      h: Math.min(100 - Math.max(0, area.y - 0.3), area.h + 0.6),
    };
    const rect = areaToPageRect(pageSpaceOf(page), padded);
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
