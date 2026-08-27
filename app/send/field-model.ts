import {
  defaultRequired,
  type DocumentField,
  type FieldType,
} from "@/src/lib/pdf/fields";

export type PlacedField = {
  id: string;
  type: FieldType;
  signerIndex: number;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
};

export const SIGNER_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
] as const;

export function signerColor(index: number): string {
  return SIGNER_COLORS[index % SIGNER_COLORS.length]!;
}

export const DEFAULT_FIELD_SIZES: Record<FieldType, { w: number; h: number }> = {
  signature: { w: 22, h: 5 },
  initials: { w: 8, h: 5 },
  date: { w: 14, h: 3.5 },
  name: { w: 18, h: 3.5 },
  text: { w: 18, h: 3.5 },
  checkbox: { w: 3, h: 3 },
};

let nextId = 0;
function localId(): string {
  nextId += 1;
  return `pf_${nextId}`;
}

export function clampToPage(f: PlacedField): PlacedField {
  const w = Math.min(f.w, 100);
  const h = Math.min(f.h, 100);
  return {
    ...f,
    w,
    h,
    x: Math.min(Math.max(f.x, 0), 100 - w),
    y: Math.min(Math.max(f.y, 0), 100 - h),
  };
}

export function makePlacedField(
  type: FieldType,
  signerIndex: number,
  page: number,
  x: number,
  y: number,
): PlacedField {
  const size = DEFAULT_FIELD_SIZES[type];
  return clampToPage({
    id: localId(),
    type,
    signerIndex,
    page,
    x: x - size.w / 2,
    y: y - size.h / 2,
    w: size.w,
    h: size.h,
    required: defaultRequired(type),
  });
}

export function serializeFields(placed: PlacedField[]): DocumentField[] {
  const counts = new Map<string, number>();
  return placed.map((f) => {
    const n = (counts.get(f.type) ?? 0) + 1;
    counts.set(f.type, n);
    return {
      name: `${f.type}_${n}`,
      type: f.type,
      role: `Signer ${f.signerIndex + 1}`,
      required: f.required,
      readonly: false,
      areas: [{ page: f.page, x: f.x, y: f.y, w: f.w, h: f.h }],
    };
  });
}

export function removeSignerFields(
  placed: PlacedField[],
  signerIndex: number,
): PlacedField[] {
  return placed
    .filter((f) => f.signerIndex !== signerIndex)
    .map((f) =>
      f.signerIndex > signerIndex
        ? { ...f, signerIndex: f.signerIndex - 1 }
        : f,
    );
}
