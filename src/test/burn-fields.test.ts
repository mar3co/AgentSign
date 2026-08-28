import { describe, it, expect } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { burnFields } from "../lib/pdf/burnFields.js";
import { decodedPageContents, minimalPdf } from "./pdf.js";

describe("burnFields", () => {
  it("burns a checkbox X and changes page bytes vs original", async () => {
    const original = await minimalPdf();
    const fields = [
      {
        name: "agree",
        type: "checkbox" as const,
        role: "Signer 1",
        required: true,
        readonly: false,
        areas: [{ page: 1, x: 10, y: 80, w: 5, h: 5 }],
      },
    ];
    const burned = await burnFields(original, {
      fields,
      parties: [
        {
          role: "Signer 1",
          kind: "human",
          name: "Jane",
          email: "jane@example.com",
          signedAt: new Date(),
          values: { agree: true },
          pngs: {},
        },
      ],
    });
    expect(Buffer.from(burned).equals(Buffer.from(original))).toBe(false);
    const doc = await PDFDocument.load(burned);
    expect(doc.getPageCount()).toBe(1);
  });

  it("burns text upright on a rotated page", async () => {
    const src = await PDFDocument.create();
    src.addPage([612, 792]).setRotation(degrees(90));
    const original = await src.save();
    const burned = await burnFields(original, {
      fields: [
        {
          name: "note",
          type: "text" as const,
          role: "Signer 1",
          required: true,
          readonly: false,
          areas: [{ page: 1, x: 25, y: 50, w: 25, h: 10 }],
        },
      ],
      parties: [
        {
          role: "Signer 1",
          kind: "human",
          name: "Jane",
          email: "jane@example.com",
          signedAt: new Date(),
          values: { note: "hello" },
          pngs: {},
        },
      ],
    });
    expect(Buffer.from(burned).equals(Buffer.from(original))).toBe(false);
    // Text is drawn rotated 90° (Tm matrix 0 1 -1 0) so it reads upright
    // in the displayed orientation.
    const drawn = await decodedPageContents(burned);
    // Clip rect mapped into user space: x=306 y=198 w=61.2 h=198.
    expect(drawn).toMatch(/\n306 198 61\.1\d+ 198 re\n/);
    // cos(90°) prints as a float epsilon, sin(90°) as 1 / -1.
    expect(drawn).toMatch(/ 1 -1 \S+ [\d.]+ [\d.]+ Tm\n/);
  });

  it("rejects duplicate party roles instead of first-match", async () => {
    const original = await minimalPdf();
    await expect(
      burnFields(original, {
        fields: [
          {
            name: "sig",
            type: "signature",
            role: "Signer 1",
            required: true,
            readonly: false,
            areas: [{ page: 1, x: 10, y: 80, w: 40, h: 10 }],
          },
        ],
        parties: [
          {
            role: "Signer 1",
            kind: "human",
            name: "Jane",
            email: "jane@example.com",
            signedAt: new Date(),
            values: {},
            pngs: {},
          },
          {
            role: "Signer 1",
            kind: "human",
            name: "Bob",
            email: "bob@example.com",
            signedAt: new Date(),
            values: {},
            pngs: {},
          },
        ],
      }),
    ).rejects.toThrow(/unique/i);
  });
});
