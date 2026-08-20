import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { appendSignaturePage } from "../lib/pdf/appendSignaturePage.js";
import { minimalPdf } from "./pdf.js";

describe("appendSignaturePage", () => {
  it("adds exactly one page with the signer name", async () => {
    const input = await minimalPdf();
    const before = await PDFDocument.load(input);
    expect(before.getPageCount()).toBe(1);
    // 1x1 opaque PNG
    const png = Uint8Array.from(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ));
    const out = await appendSignaturePage(input, {
      png,
      name: "Jane Doe",
      email: "jane@example.com",
      signedAt: new Date("2026-08-20T12:00:00Z"),
    });
    const after = await PDFDocument.load(out);
    expect(after.getPageCount()).toBe(2);
    // object streams off so @signpdf placeholders can be patched later
    expect(Buffer.from(out).includes(Buffer.from("Jane Doe"))).toBe(true);
  });
});
