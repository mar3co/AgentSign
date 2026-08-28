import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { extractAcroFields, importAcroFields } from "../lib/pdf/acroform.js";

async function fillablePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();

  const name = form.createTextField("Full Name");
  name.addToPage(page, { x: 72, y: 700, width: 200, height: 18 });

  const date = form.createTextField("Signing Date");
  date.addToPage(page, { x: 72, y: 660, width: 120, height: 18 });

  const agree = form.createCheckBox("Agree");
  agree.check();
  agree.addToPage(page, { x: 72, y: 620, width: 14, height: 14 });

  const notes = form.createTextField("Notes");
  notes.setText("prefilled");
  notes.addToPage(page, { x: 72, y: 580, width: 200, height: 18 });

  const locked = form.createTextField("Locked");
  locked.enableReadOnly();
  locked.addToPage(page, { x: 72, y: 540, width: 200, height: 18 });

  const color = form.createDropdown("Color");
  color.addOptions(["red", "blue"]);
  color.addToPage(page, { x: 72, y: 500, width: 100, height: 18 });

  return doc.save();
}

describe("extractAcroFields", () => {
  it("maps text, date-named, and checkbox fields with acro_ names", async () => {
    const fields = await extractAcroFields(await fillablePdf());
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

    expect(byName["acro_Full Name"]?.type).toBe("text");
    expect(byName["acro_Signing Date"]?.type).toBe("date");
    expect(byName["acro_Agree"]?.type).toBe("checkbox");
    expect(byName["acro_Agree"]?.default_value).toBe(true);
    expect(byName["acro_Notes"]?.default_value).toBe("prefilled");
    // Readonly fields can't be filled; dropdowns have no model equivalent.
    expect(byName["acro_Locked"]).toBeUndefined();
    expect(byName["acro_Color"]).toBeUndefined();
    expect(fields.every((f) => f.role === "Signer 1")).toBe(true);
  });

  it("maps a widget rect to a percent area within 1 percent", async () => {
    const fields = await extractAcroFields(await fillablePdf());
    const area = fields.find((f) => f.name === "acro_Full Name")!.areas[0]!;
    expect(area.page).toBe(1);
    expect(Math.abs(area.x - (72 / 612) * 100)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(area.y - ((792 - (700 + 18)) / 792) * 100),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(area.w - (200 / 612) * 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(area.h - (18 / 792) * 100)).toBeLessThanOrEqual(1);
  });

  it("maps widgets on a rotated page through display space", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.setRotation(degrees(90));
    const field = doc.getForm().createTextField("Rotated");
    field.addToPage(page, { x: 72, y: 700, width: 200, height: 18 });
    const fields = await extractAcroFields(await doc.save());
    const area = fields[0]!.areas[0]!;
    // Rotate 90 displays the page clockwise as 792x612: user-space y becomes
    // display x, and user-space x becomes display y measured from the top.
    expect(Math.abs(area.x - (700 / 792) * 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(area.y - (72 / 612) * 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(area.w - (18 / 792) * 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(area.h - (200 / 612) * 100)).toBeLessThanOrEqual(1);
  });

  it("returns no fields for a PDF without a form", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    expect(await extractAcroFields(await doc.save())).toEqual([]);
  });

  it("binds imported fields to the given role", async () => {
    const fields = await extractAcroFields(await fillablePdf(), "Buyer");
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.role === "Buyer")).toBe(true);
  });

  it("clamps partially off-page widgets and skips fully off-page ones", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    const partial = form.createTextField("Partial");
    partial.addToPage(page, { x: 560, y: 700, width: 100, height: 18 });
    const hidden = form.createTextField("Hidden");
    hidden.addToPage(page, { x: 700, y: 700, width: 100, height: 18 });

    const fields = await extractAcroFields(await doc.save());
    const names = fields.map((f) => f.name);
    expect(names).toContain("acro_Partial");
    expect(names).not.toContain("acro_Hidden");
    const area = fields.find((f) => f.name === "acro_Partial")!.areas[0]!;
    expect(area.x).toBeGreaterThanOrEqual(0);
    expect(area.x + area.w).toBeLessThanOrEqual(100);
  });
});

describe("importAcroFields", () => {
  it("removes imported widgets and keeps unsupported ones", async () => {
    const bytes = await fillablePdf();
    const result = await importAcroFields(bytes);
    expect(result.fields.length).toBe(4);

    const doc = await PDFDocument.load(result.pdf);
    const remaining = doc
      .getForm()
      .getFields()
      .map((f) => f.getName())
      .sort();
    expect(remaining).toEqual(["Color", "Locked"]);
  });

  it("returns bytes unchanged when there is nothing to import", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const result = await importAcroFields(bytes);
    expect(result.fields).toEqual([]);
    expect(result.pdf).toBe(bytes);
  });
});
