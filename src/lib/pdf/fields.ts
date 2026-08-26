import { z } from "zod";

export const fieldTypes = [
  "signature",
  "initials",
  "date",
  "name",
  "text",
  "checkbox",
] as const;
export type FieldType = (typeof fieldTypes)[number];

export type FieldArea = {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DocumentField = {
  name: string;
  type: FieldType;
  role: string;
  required: boolean;
  readonly: boolean;
  default_value?: string | boolean;
  areas: FieldArea[];
};

const MAX_FIELDS = 200;
const MAX_AREAS = 20;

const requiredByType: Record<FieldType, boolean> = {
  signature: true,
  initials: true,
  date: true,
  name: true,
  text: false,
  checkbox: false,
};

const fieldAreaSchema = z
  .object({
    page: z.number().int().positive(),
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite().gt(0),
    h: z.number().finite().gt(0),
  })
  .refine(
    (a) => a.x < 100 && a.x + a.w > 0 && a.y < 100 && a.y + a.h > 0,
    { message: "area must intersect the page" },
  );

const documentFieldSchema = z
  .object({
    name: z.string().min(1).max(80),
    type: z.enum(fieldTypes),
    role: z.string().min(1).max(80),
    required: z.boolean().optional(),
    readonly: z.boolean().optional(),
    default_value: z.union([z.string(), z.boolean()]).optional(),
    areas: z.array(fieldAreaSchema).min(1).max(MAX_AREAS),
  })
  .transform((f) => ({
    ...f,
    required: f.required ?? requiredByType[f.type],
    readonly: f.readonly ?? false,
  }));

type FieldsResult =
  | { ok: true; fields: DocumentField[] }
  | { ok: false; error: string; code: "invalid_fields" };

function invalid(error: string): FieldsResult {
  return { ok: false, error, code: "invalid_fields" };
}

export function fieldsFitPageCount(
  fields: DocumentField[],
  pageCount: number,
): FieldsResult {
  for (const field of fields) {
    for (const area of field.areas) {
      if (area.page > pageCount) {
        return invalid("area page is out of range");
      }
    }
  }
  return { ok: true, fields };
}

export function defaultRoleName(signingOrder: number): string {
  return `Signer ${signingOrder}`;
}

export function mergeFields(
  a: DocumentField[],
  b: DocumentField[],
): FieldsResult {
  const out: DocumentField[] = [];
  const index = new Map<string, number>();

  const add = (field: DocumentField): string | null => {
    const key = `${field.role}\0${field.name}`;
    const existingIdx = index.get(key);
    if (existingIdx === undefined) {
      if (out.length >= MAX_FIELDS) return "too many fields";
      index.set(key, out.length);
      out.push({
        ...field,
        areas: [...field.areas],
      });
      return null;
    }
    const existing = out[existingIdx]!;
    if (
      existing.type !== field.type ||
      existing.required !== field.required ||
      existing.readonly !== field.readonly
    ) {
      return "conflicting field definition";
    }
    const areas = existing.areas.concat(field.areas);
    if (areas.length > MAX_AREAS) return "too many areas";
    existing.areas = areas;
    if (field.default_value !== undefined) {
      existing.default_value = field.default_value;
    }
    return null;
  };

  for (const field of a) {
    const err = add(field);
    if (err) return invalid(err);
  }
  for (const field of b) {
    const err = add(field);
    if (err) return invalid(err);
  }
  return { ok: true, fields: out };
}

export function parseFieldsJson(raw: unknown): FieldsResult {
  const parsed = z.array(documentFieldSchema).max(MAX_FIELDS).safeParse(raw);
  if (!parsed.success) {
    return invalid(parsed.error.issues[0]?.message ?? "invalid fields");
  }
  return mergeFields(parsed.data, []);
}

export function areaToPdfRect(
  pageWidth: number,
  pageHeight: number,
  area: FieldArea,
): { x: number; y: number; w: number; h: number } {
  let x = (area.x / 100) * pageWidth;
  let w = (area.w / 100) * pageWidth;
  const top = (area.y / 100) * pageHeight;
  let h = (area.h / 100) * pageHeight;
  let y = pageHeight - top - h;
  const x2 = Math.min(pageWidth, Math.max(0, x + w));
  const y2 = Math.min(pageHeight, Math.max(0, y + h));
  x = Math.min(pageWidth, Math.max(0, x));
  y = Math.min(pageHeight, Math.max(0, y));
  w = Math.max(0, x2 - x);
  h = Math.max(0, y2 - y);
  return { x, y, w, h };
}
