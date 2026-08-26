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

  it("parses a text tag area within 1 percent of the drawn box", async () => {
    const pageWidth = 612;
    const pageHeight = 792;
    const x = 72;
    const y = 700;
    const size = 12;
    const text = "{{Full Name;type=text;role=Signer 1}}";
    const doc = await PDFDocument.create();
    const page = doc.addPage([pageWidth, pageHeight]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(text, { x, y, size, font });
    const w = font.widthOfTextAtSize(text, size);
    const result = await parsePdfTags(await doc.save());
    const field = result.fields.find((f) => f.name === "Full Name");
    expect(field).toBeTruthy();
    const area = field!.areas[0]!;
    expect(area.page).toBe(1);
    expect(Math.abs(area.x - (x / pageWidth) * 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(area.y - ((pageHeight - (y + size)) / pageHeight) * 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(area.w - (w / pageWidth) * 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(area.h - (size / pageHeight) * 100)).toBeLessThanOrEqual(1);
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

  it("parses init, date, and name aliases", async () => {
    const bytes = await drawTags(["{{init}}", "{{date}}", "{{name}}"]);
    const result = await parsePdfTags(bytes);
    const byName = Object.fromEntries(result.fields.map((f) => [f.name, f.type]));
    expect(byName.init).toBe("initials");
    expect(byName.date).toBe("date");
    expect(byName.name).toBe("name");
  });

  it("unknown type throws invalid_fields", async () => {
    const bytes = await drawTags(["{{Pay;type=payment}}"]);
    await expect(parsePdfTags(bytes)).rejects.toMatchObject({
      code: "invalid_fields",
    });
  });
});
