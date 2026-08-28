import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import {
  applyPatches,
  clampPatch,
  dropOutOfRangePatches,
  makePatch,
  patchesCoverTags,
  PatchTextError,
} from "../../app/send/patch-model.js";
import { decodedPageContents, minimalPdf } from "./pdf.js";

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

  it("detects a patch covering a tag field on the same page only", () => {
    const tagFields = [{ areas: [{ page: 2, x: 10, y: 80, w: 20, h: 5 }] }];
    expect(
      patchesCoverTags([makePatch(2, 15, 78, 20, 10)], tagFields),
    ).toBe(true);
    // Same rect on another page, or elsewhere on the page, doesn't count.
    expect(
      patchesCoverTags([makePatch(1, 15, 78, 20, 10)], tagFields),
    ).toBe(false);
    expect(patchesCoverTags([makePatch(2, 50, 10, 5, 5)], tagFields)).toBe(
      false,
    );
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

  it("places the whiteout and text baseline where the preview showed them", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    // Display rect for (10%, 80%, 40%, 6%) of 612x792, bottom-left origin.
    const rx = 61.2;
    const ry = 110.88;
    const rh = 47.52;
    const patch = { ...makePatch(1, 10, 80, 40, 6), text: "Corrected" };
    const out = await applyPatches(bytes, [patch]);
    const drawn = await decodedPageContents(out);
    const cm = drawn.match(/1 0 0 1 ([\d.]+) ([\d.]+) cm/);
    expect(cm).not.toBeNull();
    expect(Number(cm![1])).toBeCloseTo(rx);
    expect(Number(cm![2])).toBeCloseTo(ry);
    // The baseline sits a descent above the centered glyph-box bottom.
    const scratch = await PDFDocument.create();
    const font = await scratch.embedFont(StandardFonts.Helvetica);
    const textHeight = font.heightAtSize(11);
    const descent = textHeight - font.heightAtSize(11, { descender: false });
    const tm = drawn.match(/([\d.-]+) ([\d.-]+) Tm/);
    expect(tm).not.toBeNull();
    expect(Number(tm![1])).toBeCloseTo(rx + 2);
    expect(Number(tm![2])).toBeCloseTo(ry + (rh - textHeight) / 2 + descent);
  });

  it("burns the whiteout rect in rotated-page coordinates", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).setRotation(degrees(90));
    const bytes = await doc.save();
    // Displayed page is 792x612; a display rect x=25% y=50% w=25% h=10%
    // must land at user-space x=306 y=198 w=61.2 h=198 (width/height swap).
    const out = await applyPatches(bytes, [makePatch(1, 25, 50, 25, 10)]);
    const drawn = await decodedPageContents(out);
    // pdf-lib translates to the rect origin, then draws the path from 0 0.
    expect(drawn).toMatch(/1 0 0 1 306 198 cm/);
    expect(drawn).toMatch(/\n61\.1\d+ 198 l\n/);
  });

  it("throws PatchTextError for text Helvetica cannot encode", async () => {
    const bytes = await minimalPdf();
    const patch = { ...makePatch(1, 10, 10, 40, 6), text: "签名" };
    await expect(applyPatches(bytes, [patch])).rejects.toBeInstanceOf(
      PatchTextError,
    );
  });
});
