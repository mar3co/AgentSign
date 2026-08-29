import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { detectFieldCandidates } from "../lib/pdf/detect.js";

async function drawLines(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 700;
  for (const line of lines) {
    page.drawText(line, { x: 72, y, size: 12, font });
    y -= 24;
  }
  return doc.save();
}

describe("detectFieldCandidates", () => {
  it("classifies labeled underscore blanks by keyword", async () => {
    const bytes = await drawLines([
      "Signature: ____________",
      "Date: ________",
      "Print Name: ____________",
      "Initials: ______",
      "Address: ____________",
    ]);
    const fields = await detectFieldCandidates(bytes);
    const types = fields.map((f) => f.type);
    expect(types).toEqual(["signature", "date", "name", "initials", "text"]);
    expect(fields.every((f) => f.role === "Signer 1")).toBe(true);
    expect(fields.every((f) => f.name.startsWith("detected_"))).toBe(true);
  });

  it("positions a blank's field over the underscores", async () => {
    const pageWidth = 612;
    const label = "Date: ";
    const blank = "________";
    const doc = await PDFDocument.create();
    const page = doc.addPage([pageWidth, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(label + blank, { x: 72, y: 700, size: 12, font });
    const labelW = font.widthOfTextAtSize(label, 12);
    const blankW = font.widthOfTextAtSize(blank, 12);
    const fields = await detectFieldCandidates(await doc.save());
    expect(fields).toHaveLength(1);
    const area = fields[0]!.areas[0]!;
    expect(area.page).toBe(1);
    expect(Math.abs(area.x - ((72 + labelW) / pageWidth) * 100)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(area.w - (blankW / pageWidth) * 100)).toBeLessThanOrEqual(1.5);
  });

  it("detects two blanks on one line", async () => {
    const bytes = await drawLines(["Signature: ________ Date: ________"]);
    const fields = await detectFieldCandidates(bytes);
    expect(fields.map((f) => f.type)).toEqual(["signature", "date"]);
  });

  it("suggests a box after a bare keyword label", async () => {
    const bytes = await drawLines(["Signature:"]);
    const fields = await detectFieldCandidates(bytes);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.type).toBe("signature");
    // The box goes after the label text, not on top of it: the label starts
    // at 72pt on a 612pt page (~11.8%), so the box must start past that.
    const area = fields[0]!.areas[0]!;
    expect(area.page).toBe(1);
    expect(area.x).toBeGreaterThan(18);
  });

  it("ignores dividers, prose, and non-keyword bare labels", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("This agreement is made between the parties.", {
      x: 72,
      y: 700,
      size: 12,
      font,
    });
    // A wide unlabeled underscore run reads as a divider.
    page.drawText("_".repeat(80), { x: 36, y: 650, size: 12, font });
    page.drawText("Comments:", { x: 72, y: 600, size: 12, font });
    const fields = await detectFieldCandidates(await doc.save());
    expect(fields).toEqual([]);
  });
});
