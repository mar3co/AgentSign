import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { parsePdfTags } from "../lib/pdf/tags.js";

async function drawTags(labels: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 700;
  for (const label of labels) {
    page.drawText(label, { x: 72, y, size: 12, font });
    y -= 24;
  }
  return doc.save();
}

describe("parsePdfTags", () => {
  it("parses {{sig}} and a named text tag and whites them out", async () => {
    const bytes = await drawTags([
      "{{sig}}",
      "{{Full Name;type=text;role=Signer 1}}",
    ]);
    const result = await parsePdfTags(bytes);
    const names = result.fields.map((f) => f.name).sort();
    expect(names).toEqual(["Full Name", "sig"]);
    expect(result.fields.find((f) => f.name === "sig")?.type).toBe(
      "signature",
    );
    const again = await parsePdfTags(result.pdf);
    expect(again.fields).toEqual([]);
  });

  it("joins split {{ sig }} items", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("{{", { x: 72, y: 700, size: 12, font });
    page.drawText("sig", { x: 84, y: 700, size: 12, font });
    page.drawText("}}", { x: 102, y: 700, size: 12, font });
    const result = await parsePdfTags(await doc.save());
    expect(result.fields.some((f) => f.type === "signature")).toBe(true);
  });

  it("unknown type throws invalid_fields", async () => {
    const bytes = await drawTags(["{{Pay;type=payment}}"]);
    await expect(parsePdfTags(bytes)).rejects.toMatchObject({
      code: "invalid_fields",
    });
  });
});
