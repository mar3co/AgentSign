import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { burnFields } from "../lib/pdf/burnFields.js";
import { minimalPdf } from "./pdf.js";

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
