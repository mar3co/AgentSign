import { describe, expect, it } from "vitest";
import {
  areaToPdfRect,
  defaultRoleName,
  mergeFields,
  parseFieldsJson,
} from "../lib/pdf/fields.js";

describe("fields", () => {
  it("defaultRoleName is Signer N", () => {
    expect(defaultRoleName(1)).toBe("Signer 1");
    expect(defaultRoleName(2)).toBe("Signer 2");
  });

  it("parses a signature field and rejects unknown type", () => {
    const ok = parseFieldsJson([
      {
        name: "sig",
        type: "signature",
        role: "Signer 1",
        required: true,
        readonly: false,
        areas: [{ page: 1, x: 10, y: 20, w: 30, h: 8 }],
      },
    ]);
    expect(ok.ok).toBe(true);
    const bad = parseFieldsJson([
      {
        name: "sig",
        type: "payment",
        role: "Signer 1",
        required: true,
        readonly: false,
        areas: [{ page: 1, x: 10, y: 20, w: 30, h: 8 }],
      },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("invalid_fields");
  });

  it("merges areas for the same name+role and rejects type conflict", () => {
    const a = parseFieldsJson([
      {
        name: "sig",
        type: "signature",
        role: "Signer 1",
        required: true,
        readonly: false,
        areas: [{ page: 1, x: 10, y: 20, w: 30, h: 8 }],
      },
    ]);
    const b = parseFieldsJson([
      {
        name: "sig",
        type: "signature",
        role: "Signer 1",
        required: true,
        readonly: false,
        areas: [{ page: 2, x: 10, y: 20, w: 30, h: 8 }],
      },
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const merged = mergeFields(a.fields, b.fields);
    expect(merged.ok).toBe(true);
    if (merged.ok) expect(merged.fields[0]!.areas).toHaveLength(2);
    const conflict = mergeFields(a.fields, [{ ...a.fields[0]!, type: "text" }]);
    expect(conflict.ok).toBe(false);
  });

  it("areaToPdfRect converts percent top-left to pdf-lib bottom-left on Letter", () => {
    const r = areaToPdfRect(612, 792, { page: 1, x: 0, y: 0, w: 50, h: 10 });
    expect(r.x).toBe(0);
    expect(r.w).toBe(306);
    expect(r.h).toBeCloseTo(79.2);
    expect(r.y).toBeCloseTo(792 - 79.2);
  });

  it("areaToPdfRect clamps overflow to the page", () => {
    const r = areaToPdfRect(612, 792, { page: 1, x: 90, y: 90, w: 20, h: 20 });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(612);
    expect(r.y + r.h).toBeLessThanOrEqual(792);
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  });
});
