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

export type SignatureAppearance = {
  png?: Uint8Array;
  name: string;
  email: string;
  signedAt: Date;
  kind?: "human" | "agent";
  footer?: string;
  documentId?: string;
  banner?: string;
  humanSignatures?: number;
  agentAttestations?: number;
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
  // Uncompressed + PDFString so name/email/time are byte-searchable (drawText hex+Flate).
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

export async function appendSignaturePage(
  pdf: Uint8Array,
  appearance: SignatureAppearance,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);

  const form = doc.getForm();
  if (form.getFields().length > 0) {
    form.flatten();
  }

  const page = doc.addPage(PageSizes.Letter);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontKey = page.node.newFontDictionary(font.name, font.ref);

  const margin = 72;
  const { height } = page.getSize();
  let y = height - margin;
  const size = 12;
  const kind = appearance.kind ?? "human";

  if (appearance.banner) {
    drawLiteralText(doc, page, fontKey, appearance.banner, margin, y, size);
    y -= 24;
  }

  if (appearance.documentId) {
    drawLiteralText(
      doc,
      page,
      fontKey,
      `Document id: ${appearance.documentId}`,
      margin,
      y,
      size,
    );
    y -= 18;
  }

  if (kind !== "agent" && appearance.png && appearance.png.byteLength > 0) {
    const image = await doc.embedPng(appearance.png);
    const imageWidth = Math.min(200, image.width);
    const imageHeight =
      image.width === 0 ? 0 : (image.height / image.width) * imageWidth;
    y -= imageHeight;
    page.drawImage(image, {
      x: margin,
      y,
      width: imageWidth,
      height: imageHeight,
    });
  }

  y -= 24;
  if (kind === "agent") {
    drawLiteralText(
      doc,
      page,
      fontKey,
      `Attested by ${appearance.name} for ${appearance.email} at ${appearance.signedAt.toISOString()}. Not an electronic signature.`,
      margin,
      y,
      size,
    );
    y -= 18;
  } else {
    drawLiteralText(doc, page, fontKey, appearance.name, margin, y, size);
    y -= 18;
    drawLiteralText(doc, page, fontKey, appearance.email, margin, y, size);
    y -= 18;
    drawLiteralText(
      doc,
      page,
      fontKey,
      appearance.signedAt.toISOString(),
      margin,
      y,
      size,
    );
    y -= 18;
  }

  if (appearance.humanSignatures != null) {
    drawLiteralText(
      doc,
      page,
      fontKey,
      `human_signatures: ${appearance.humanSignatures}`,
      margin,
      y,
      size,
    );
    y -= 18;
  }
  if (appearance.agentAttestations != null) {
    drawLiteralText(
      doc,
      page,
      fontKey,
      `agent_attestations: ${appearance.agentAttestations}`,
      margin,
      y,
      size,
    );
  }

  if (appearance.footer) {
    drawLiteralText(
      doc,
      page,
      fontKey,
      "Sent with AgentSign",
      margin,
      margin,
      size,
    );
  }

  return doc.save({ useObjectStreams: false });
}
