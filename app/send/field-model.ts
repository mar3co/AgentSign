import {
  DEFAULT_FIELD_SIZES,
  defaultRequired,
  defaultRoleName,
  type DocumentField,
  type FieldType,
} from "@/src/lib/pdf/fields";

export { DEFAULT_FIELD_SIZES };

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
  // Machine-suggested (heuristic or AI) rather than hand-placed; suggestions
  // are replaced wholesale when the file changes or detection re-runs.
  suggested?: boolean;
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

/**
 * Detected suggestions become ordinary placed fields (assigned to the first
 * signer) so the sender can move, resize, or delete them before sending.
 * Placed fields are single-area, so multi-area detected fields split into
 * one placed field per area; names, roles, and default values are dropped.
 */
export function placedFromDetected(fields: DocumentField[]): PlacedField[] {
  return fields.flatMap((f) =>
    f.areas.map((a) =>
      clampToPage({
        id: localId(),
        type: f.type,
        signerIndex: 0,
        page: a.page,
        x: a.x,
        y: a.y,
        w: a.w,
        h: a.h,
        required: f.required,
        suggested: true,
      }),
    ),
  );
}

export function serializeFields(placed: PlacedField[]): DocumentField[] {
  const counts = new Map<string, number>();
  return placed.map((f) => {
    const n = (counts.get(f.type) ?? 0) + 1;
    counts.set(f.type, n);
    return {
      // "placed_" keeps click-placed names clear of {{tag}} names like
      // "text_1", which would collide in the server's role+name merge.
      name: `placed_${f.type}_${n}`,
      type: f.type,
      role: defaultRoleName(f.signerIndex + 1),
      required: f.required,
      readonly: false,
      areas: [{ page: f.page, x: f.x, y: f.y, w: f.w, h: f.h }],
    };
  });
}

export function dropOutOfRangeFields(
  placed: PlacedField[],
  pageCount: number,
): PlacedField[] {
  return placed.filter((f) => f.page >= 1 && f.page <= pageCount);
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
