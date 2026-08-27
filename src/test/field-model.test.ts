import { describe, expect, it } from "vitest";
import {
  clampToPage,
  makePlacedField,
  removeSignerFields,
  serializeFields,
  signerColor,
  SIGNER_COLORS,
} from "../../app/send/field-model.js";
import { parseFieldsJson } from "../lib/pdf/fields.js";

describe("field model", () => {
  it("places a field centered on the click with the type's default size", () => {
    const f = makePlacedField("signature", 0, 1, 50, 50);
    expect(f.page).toBe(1);
    expect(f.type).toBe("signature");
    expect(f.x + f.w / 2).toBeCloseTo(50, 5);
    expect(f.y + f.h / 2).toBeCloseTo(50, 5);
    expect(f.required).toBe(true); // signature defaults required
  });

  it("text and checkbox default to optional", () => {
    expect(makePlacedField("text", 0, 1, 10, 10).required).toBe(false);
    expect(makePlacedField("checkbox", 0, 1, 10, 10).required).toBe(false);
  });

  it("clamps placements to the page", () => {
    const f = clampToPage({ ...makePlacedField("signature", 0, 1, 0, 0), x: -10, y: 99 });
    expect(f.x).toBeGreaterThanOrEqual(0);
    expect(f.y + f.h).toBeLessThanOrEqual(100);
  });

  it("serializes to fields the server schema accepts, with Signer N roles and unique names", () => {
    const placed = [
      makePlacedField("signature", 0, 1, 30, 80),
      makePlacedField("signature", 1, 1, 70, 80),
      makePlacedField("date", 0, 2, 30, 85),
    ];
    const out = serializeFields(placed);
    expect(out).toHaveLength(3);
    expect(out[0]!.role).toBe("Signer 1");
    expect(out[1]!.role).toBe("Signer 2");
    expect(new Set(out.map((f) => f.name)).size).toBe(3);
    const parsed = parseFieldsJson(JSON.parse(JSON.stringify(out)));
    expect(parsed.ok).toBe(true);
  });

  it("drops a removed signer's fields and shifts later signer indexes down", () => {
    const placed = [
      makePlacedField("signature", 0, 1, 30, 80),
      makePlacedField("signature", 1, 1, 50, 80),
      makePlacedField("signature", 2, 1, 70, 80),
    ];
    const out = removeSignerFields(placed, 1);
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.signerIndex)).toEqual([0, 1]);
  });

  it("cycles signer colors", () => {
    expect(signerColor(0)).toBe(SIGNER_COLORS[0]);
    expect(signerColor(SIGNER_COLORS.length)).toBe(SIGNER_COLORS[0]);
  });
});
