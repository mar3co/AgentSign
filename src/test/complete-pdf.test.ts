import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { completeDocumentPdf } from "../lib/pdf/complete.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { minimalPdf } from "./pdf.js";
import { sha256Hex } from "../lib/hash.js";

const png = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));

describe("completeDocumentPdf", () => {
  it("seals then hashes sealed bytes; cert is a separate file", async () => {
    const p12 = makeDevP12("test");
    const original = await minimalPdf();
    const result = await completeDocumentPdf({
      original,
      appearance: { png, name: "Jane", email: "jane@example.com", signedAt: new Date() },
      p12,
      passphrase: "test",
      meta: {
        documentId: "00000000-0000-0000-0000-000000000001",
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
    const result = await completeDocumentPdf({
      original,
      appearances: [
        { png, name: "Jane", email: "jane@example.com", signedAt: new Date() },
        { png, name: "Bob", email: "bob@example.com", signedAt: new Date() },
      ],
      p12,
      passphrase: "test",
      meta: {
        documentId: "00000000-0000-0000-0000-000000000002",
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
    const latin1 = Buffer.from(result.sealed).toString("latin1");
    expect(latin1).toMatch(/BT[\s\S]{0,80}Td[\s\S]{0,80}ET/);
    expect(latin1).toContain("Jane");
    expect(latin1).toContain("Bob");
  });

  it("seals an agent appearance without a PNG", async () => {
    const p12 = makeDevP12("test");
    const original = await minimalPdf();
    const at = new Date("2026-08-21T12:00:00.000Z");
    const result = await completeDocumentPdf({
      original,
      appearances: [
        {
          kind: "agent",
          name: "Grok Legal",
          email: "shop@example.com",
          signedAt: at,
        },
      ],
      p12,
      passphrase: "test",
      meta: {
        documentId: "00000000-0000-0000-0000-000000000003",
        title: "Repair authorization",
        senderEmail: "shop@example.com",
        consentText: "I agree to sign this document electronically.",
        signers: [
          {
            name: "Grok Legal",
            email: "shop@example.com",
            kind: "agent",
            sentAt: null,
            openedAt: null,
            consentedAt: null,
            signedAt: null,
            declinedAt: null,
            attestedAt: at,
            attestMethod: "agent_key",
            attestLabel: "agent_key:sign_agent_xxxx",
            agentSlug: "grok-legal",
            ip: null,
            ua: null,
          },
        ],
      },
    });
    const latin1 = Buffer.from(result.sealed).toString("latin1");
    expect(latin1).toContain(
      "Attested by Grok Legal for shop@example.com at 2026-08-21T12:00:00.000Z. Not an electronic signature.",
    );
    expect(latin1).toContain("No human electronic signature. Agent attestations only.");
    const cert = Buffer.from(result.certificate).toString("latin1");
    expect(cert).toContain("human_signatures: 0");
    expect(cert).toContain("agent_attestations: 1");
    expect(cert).toContain("No human electronic signature. Agent attestations only.");
    expect(cert).not.toContain("Consent:");
    expect(cert).not.toContain("Sent with AgentSign");
  });
});

describe("buildCertificate", () => {
  it("paginates when many signers would run off Letter", async () => {
    const { buildCertificate } = await import("../lib/pdf/certificate.js");
    const signers = Array.from({ length: 5 }, (_, i) => ({
      name: `Signer ${i + 1}`,
      email: `s${i + 1}@example.com`,
      sentAt: new Date(),
      openedAt: new Date(),
      consentedAt: new Date(),
      signedAt: new Date(),
      declinedAt: null,
      ip: "1.2.3.4",
      ua: "test",
    }));
    const bytes = await buildCertificate({
      documentId: "00000000-0000-0000-0000-000000000005",
      title: "Repair authorization",
      senderEmail: "shop@example.com",
      sha256: "a".repeat(64),
      consentText: "I agree to sign this document electronically.",
      signers,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(Buffer.from(bytes).includes(Buffer.from("s5@example.com"))).toBe(true);
    expect(Buffer.from(bytes).includes(Buffer.from("Not a notary"))).toBe(true);
  });
});
