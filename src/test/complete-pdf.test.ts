import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { completeEnvelopePdf } from "../lib/pdf/complete.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { minimalPdf } from "./pdf.js";
import { sha256Hex } from "../lib/hash.js";

const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));

describe("completeEnvelopePdf", () => {
  it("seals then hashes sealed bytes; cert is a separate file", async () => {
    const p12 = makeDevP12("test");
    const original = await minimalPdf();
    const result = await completeEnvelopePdf({
      original,
      appearance: { png, name: "Jane", email: "jane@example.com", signedAt: new Date() },
      p12,
      passphrase: "test",
      meta: {
        envelopeId: "00000000-0000-0000-0000-000000000001",
        title: "Repair authorization",
        senderEmail: "shop@example.com",
        consentText: "I agree to sign this document electronically.",
        signers: [{
          name: "Jane",
          email: "jane@example.com",
          sentAt: new Date(),
          openedAt: new Date(),
          consentedAt: new Date(),
          signedAt: new Date(),
          declinedAt: null,
          ip: "1.2.3.4",
          ua: "test",
        }],
      },
    });
    expect(result.sha256).toBe(sha256Hex(result.sealed));
    const sealedDoc = await PDFDocument.load(result.sealed);
    const certDoc = await PDFDocument.load(result.certificate);
    expect(sealedDoc.getPageCount()).toBe(2);
    expect(certDoc.getPageCount()).toBe(1);
    expect(Buffer.from(result.certificate).includes(Buffer.from(result.sha256))).toBe(true);
  });

  it("appends one signature page per appearance then seals", async () => {
    const p12 = makeDevP12("test");
    const original = await minimalPdf();
    const result = await completeEnvelopePdf({
      original,
      appearances: [
        { png, name: "Jane", email: "jane@example.com", signedAt: new Date() },
        { png, name: "Bob", email: "bob@example.com", signedAt: new Date() },
      ],
      p12,
      passphrase: "test",
      meta: {
        envelopeId: "00000000-0000-0000-0000-000000000002",
        title: "Repair authorization",
        senderEmail: "shop@example.com",
        consentText: "I agree to sign this document electronically.",
        signers: [
          {
            name: "Jane",
            email: "jane@example.com",
            sentAt: new Date(),
            openedAt: new Date(),
            consentedAt: new Date(),
            signedAt: new Date(),
            declinedAt: null,
            ip: "1.2.3.4",
            ua: "test",
          },
          {
            name: "Bob",
            email: "bob@example.com",
            sentAt: new Date(),
            openedAt: new Date(),
            consentedAt: new Date(),
            signedAt: new Date(),
            declinedAt: null,
            ip: "1.2.3.4",
            ua: "test",
          },
        ],
      },
    });
    const sealedDoc = await PDFDocument.load(result.sealed);
    expect(sealedDoc.getPageCount()).toBe(3);
    expect(result.sha256).toBe(sha256Hex(result.sealed));
  });
});
