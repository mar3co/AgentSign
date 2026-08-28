import {
  PDFCheckBox,
  PDFDocument,
  PDFSignature,
  PDFTextField,
  type PDFField,
  type PDFRef,
} from "pdf-lib";
import {
  clampArea,
  defaultRequired,
  defaultRoleName,
  type DocumentField,
  type FieldArea,
  type FieldType,
} from "./fields.js";
import { pageRectToArea, pageSpaceOf } from "./pageSpace.js";

export type AcroImportResult = { fields: DocumentField[]; pdf: Uint8Array };

const MAX_WIDGETS_PER_FIELD = 20;

function typeOf(field: PDFField): FieldType | null {
  if (field instanceof PDFSignature) return "signature";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFTextField) {
    return /\bdate\b/i.test(field.getName()) ? "date" : "text";
  }
  // Dropdowns, option lists, radio groups, and buttons have no equivalent
  // in the field model; leave their widgets alone.
  return null;
}

function importedName(raw: string, index: number, used: Set<string>): string {
  const cleaned = raw.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  let name = `acro_${cleaned || `field_${index + 1}`}`.slice(0, 80);
  if (used.has(name)) {
    name = `${name.slice(0, 80 - 8)}_${index + 1}`;
  }
  used.add(name);
  return name;
}

function defaultValueOf(field: PDFField): string | boolean | undefined {
  if (field instanceof PDFCheckBox) {
    return field.isChecked() ? true : undefined;
  }
  if (field instanceof PDFTextField) {
    const text = field.getText()?.trim();
    return text ? text : undefined;
  }
  return undefined;
}

type Collected = { field: DocumentField; source: PDFField };

function collect(doc: PDFDocument, role: string): Collected[] {
  let acroFields: PDFField[];
  try {
    acroFields = doc.getForm().getFields();
  } catch {
    return []; // Malformed or missing AcroForm dictionary — nothing to import.
  }

  const pages = doc.getPages();
  const pageIndexByRef = new Map<PDFRef, number>(
    pages.map((p, i) => [p.ref, i]),
  );
  const used = new Set<string>();
  const out: Collected[] = [];

  for (let i = 0; i < acroFields.length; i++) {
    const source = acroFields[i]!;
    const type = typeOf(source);
    if (!type) continue;
    if (source.isReadOnly()) continue;

    let widgets;
    try {
      widgets = source.acroField.getWidgets();
    } catch {
      continue;
    }
    if (widgets.length === 0 || widgets.length > MAX_WIDGETS_PER_FIELD) {
      continue;
    }

    const areas: FieldArea[] = [];
    for (const widget of widgets) {
      const pageRef = widget.P();
      const pageIndex = pageRef ? pageIndexByRef.get(pageRef) : undefined;
      if (pageIndex === undefined) continue;
      const rect = widget.getRectangle();
      if (!(rect.width > 0) || !(rect.height > 0)) continue;
      const area = pageRectToArea(
        pageSpaceOf(pages[pageIndex]!),
        { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        pageIndex + 1,
      );
      // Widgets parked outside the visible page (cropped PDFs) aren't
      // real inputs; clamping them in would surface hidden fields.
      if (
        area.x >= 100 ||
        area.y >= 100 ||
        area.x + area.w <= 0 ||
        area.y + area.h <= 0
      ) {
        continue;
      }
      areas.push(clampArea(area));
    }
    if (areas.length === 0) continue;

    const defaultValue = defaultValueOf(source);
    out.push({
      source,
      field: {
        name: importedName(source.getName(), i, used),
        type,
        role,
        required: source.isRequired() || defaultRequired(type),
        readonly: false,
        ...(defaultValue !== undefined ? { default_value: defaultValue } : {}),
        areas,
      },
    });
  }
  return out;
}

/** Read fillable AcroForm fields as DocumentFields without touching the PDF. */
export async function extractAcroFields(
  bytes: Uint8Array,
  role: string = defaultRoleName(1),
): Promise<DocumentField[]> {
  try {
    const doc = await PDFDocument.load(bytes);
    return collect(doc, role).map((c) => c.field);
  } catch {
    return []; // Import is best-effort; an unreadable form just means no fields.
  }
}

/**
 * Import fillable AcroForm fields and remove them from the PDF, so the
 * stored copy has no interactive widgets competing with the burned overlay.
 */
export async function importAcroFields(
  bytes: Uint8Array,
  role: string = defaultRoleName(1),
): Promise<AcroImportResult> {
  try {
    const doc = await PDFDocument.load(bytes);
    const collected = collect(doc, role);
    if (collected.length === 0) return { fields: [], pdf: bytes };
    const form = doc.getForm();
    for (const c of collected) form.removeField(c.source);
    return {
      fields: collected.map((c) => c.field),
      pdf: await doc.save(),
    };
  } catch {
    return { fields: [], pdf: bytes };
  }
}
