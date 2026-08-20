import {
  PDFDocument,
  PageSizes,
  StandardFonts,
  PDFString,
  PDFContentStream,
  PDFName,
  type PDFPage,
  beginText,
  endText,
  setFontAndSize,
  showText,
  moveText,
  pushGraphicsState,
  popGraphicsState,
} from "pdf-lib";

export type CertificateSigner = {
  name: string;
  email: string;
  sentAt: Date | null;
  openedAt: Date | null;
  consentedAt: Date | null;
  signedAt: Date | null;
  declinedAt: Date | null;
  ip: string | null;
  ua: string | null;
};

export type CertificateInfo = {
  envelopeId: string;
  title: string;
  senderEmail: string;
  sha256: string;
  consentText: string;
  signers: CertificateSigner[];
};

function drawLiteralText(
  doc: PDFDocument,
  page: PDFPage,
  fontKey: PDFName,
  text: string,
  x: number,
  y: number,
  size: number,
): void {
  // Uncompressed + PDFString so SHA-256 hex is byte-searchable (drawText hex+Flate).
  const stream = PDFContentStream.of(
    doc.context.obj({}),
    [
      pushGraphicsState(),
      beginText(),
      setFontAndSize(fontKey, size),
      moveText(x, y),
      showText(PDFString.of(text) as never),
      endText(),
      popGraphicsState(),
    ],
    false,
  );
  page.node.addContentStream(doc.context.register(stream));
}

function utc(d: Date | null): string {
  return d ? d.toISOString() : "—";
}

function wrapLine(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [text];
}

export async function buildCertificate(
  info: CertificateInfo,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage(PageSizes.Letter);
  let fontKey = page.node.newFontDictionary(font.name, font.ref);
  const { height } = page.getSize();
  const margin = 72;
  const size = 11;
  const line = 16;
  let y = height - margin;

  const lines: string[] = [
    "Certificate of completion",
    "",
    `Envelope id: ${info.envelopeId}`,
    `Title: ${info.title}`,
    `Sender: ${info.senderEmail}`,
    "",
    `SHA-256: ${info.sha256}`,
    "",
    `Consent: ${info.consentText}`,
    "All times UTC.",
    "",
  ];

  for (const signer of info.signers) {
    lines.push(
      `Signer: ${signer.name} <${signer.email}>`,
      `Auth method: Unique link sent to ${signer.email}`,
      `Sent: ${utc(signer.sentAt)}`,
      `Opened: ${utc(signer.openedAt)}`,
      `Consented: ${utc(signer.consentedAt)}`,
      `Signed: ${utc(signer.signedAt)}`,
      `Declined: ${utc(signer.declinedAt)}`,
      `IP: ${signer.ip ?? "—"}`,
      `UA: ${signer.ua ?? "—"}`,
      "",
    );
  }

  lines.push("Not a notary. Not legal advice.");

  for (const raw of lines) {
    const wrapped =
      raw.includes(info.sha256) || raw.length <= 90
        ? [raw]
        : wrapLine(raw, 90);
    for (const text of wrapped) {
      if (y < margin) {
        page = doc.addPage(PageSizes.Letter);
        fontKey = page.node.newFontDictionary(font.name, font.ref);
        y = height - margin;
      }
      if (text) {
        drawLiteralText(doc, page, fontKey, text, margin, y, size);
      }
      y -= line;
    }
  }

  return doc.save({ useObjectStreams: false });
}
