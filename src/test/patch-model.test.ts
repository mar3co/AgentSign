import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  applyPatches,
  clampPatch,
  dropOutOfRangePatches,
  makePatch,
} from "../../app/send/patch-model.js";
import { minimalPdf } from "./pdf.js";

describe("patch model", () => {
  it("makePatch defaults to whiteout-only with 11pt text size", () => {
    const p = makePatch(1, 10, 20, 30, 5);
    expect(p.text).toBe("");
    expect(p.fontSize).toBe(11);
    expect(p.page).toBe(1);
  });

  it("clamps patches to the page", () => {
    const p = clampPatch({ ...makePatch(1, 0, 0, 30, 5), x: -10, y: 99 });
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y + p.h).toBeLessThanOrEqual(100);
  });

  it("drops patches on out-of-range pages", () => {
    const kept = dropOutOfRangePatches(
      [makePatch(1, 10, 10, 10, 5), makePatch(3, 10, 10, 10, 5)],
      2,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.page).toBe(1);
  });

  it("returns input bytes unchanged when there are no patches", async () => {
    const bytes = await minimalPdf();
    const out = await applyPatches(bytes, []);
    expect(out).toBe(bytes);
  });

  it("burns a whiteout and text into the PDF", async () => {
    const bytes = await minimalPdf();
    const patch = { ...makePatch(1, 10, 10, 40, 6), text: "Corrected" };
    const out = await applyPatches(bytes, [patch]);
    expect(out).not.toBe(bytes);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(out.byteLength).toBeGreaterThan(0);
  });
});
