import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { docxToPdf, isDocx, isLegacyDoc } from "../lib/docx.js";
import { parsePdfTags } from "../lib/pdf/tags.js";

const fixture = () =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL("./fixtures/sample.docx", import.meta.url))),
  );

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Conversion prints through a local Chrome/Chromium; skip where none exists.
const hasChrome = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].some((p) => existsSync(p));

describe("isDocx / isLegacyDoc", () => {
  it("detects docx by zip magic plus mime or extension", () => {
    const bytes = fixture();
    expect(isDocx(bytes, DOCX_MIME, "x.bin")).toBe(true);
    expect(isDocx(bytes, "", "contract.DOCX")).toBe(true);
    expect(isDocx(bytes, "", "archive.zip")).toBe(false);
    expect(isDocx(new Uint8Array([0x25, 0x50, 0x44, 0x46]), DOCX_MIME, "a.docx")).toBe(false);
  });

  it("recognizes legacy .doc containers", () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    expect(isLegacyDoc(ole, "application/msword", "x.bin")).toBe(true);
    expect(isLegacyDoc(ole, "", "old.doc")).toBe(true);
    expect(isLegacyDoc(fixture(), "", "new.docx")).toBe(false);
  });
});

describe("docxToPdf", () => {
  it.skipIf(!hasChrome)(
    "produces a PDF whose text keeps {{tags}}",
    async () => {
      const pdf = await docxToPdf(fixture());
      expect(pdf[0]).toBe(0x25); // %PDF
      const parsed = await parsePdfTags(pdf);
      expect(parsed.fields.some((f) => f.type === "signature")).toBe(true);
    },
    60_000,
  );

  it("rejects bytes that are not a DOCX", async () => {
    await expect(
      docxToPdf(new Uint8Array([1, 2, 3, 4])),
    ).rejects.toMatchObject({ code: "docx_invalid" });
  });
});
