import { PDFDocument } from "pdf-lib";
import signpdf from "@signpdf/signpdf";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { P12Signer } from "@signpdf/signer-p12";
import { getEnv } from "../../env.js";

/** The address a reader sees in the signature's ContactInfo. Taken from
 *  FROM_EMAIL ("OpenSeal <sign@openseal.me>" or a bare address) so a
 *  self-host seals with its own contact, not ours. */
function sealContact(): string {
  const from = getEnv().FROM_EMAIL.trim();
  return from.match(/<([^>]+)>/)?.[1]?.trim() || from;
}

export async function sealPdf(
  pdf: Uint8Array,
  p12: Buffer,
  passphrase: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdf);
  const pages = pdfDoc.getPages();
  pdflibAddPlaceholder({
    pdfDoc,
    pdfPage: pages[pages.length - 1],
    reason: "Document electronically signed",
    contactInfo: sealContact(),
    name: "OpenSeal",
    location: "UTC",
    // Default 8192 can be tight for RSA-2048 + cert in PKCS#7.
    signatureLength: 16384,
  });
  // Object streams hide ByteRange placeholders from @signpdf's byte patcher.
  const withPlaceholder = await pdfDoc.save({ useObjectStreams: false });
  const signer = new P12Signer(p12, { passphrase });
  const client =
    typeof (signpdf as { sign?: unknown }).sign === "function"
      ? signpdf
      : (signpdf as unknown as { default: typeof signpdf }).default;
  const signed = await client.sign(withPlaceholder, signer);
  return Uint8Array.from(signed);
}
