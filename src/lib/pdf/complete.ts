import { sha256Hex } from "../hash.js";
import {
  appendSignaturePage,
  type SignatureAppearance,
} from "./appendSignaturePage.js";
import { buildCertificate, type CertificateInfo } from "./certificate.js";
import { sealPdf } from "./seal.js";

export type CompleteMeta = Omit<CertificateInfo, "sha256">;

export type CompleteEnvelopeInput = {
  original: Uint8Array;
  appearance: SignatureAppearance;
  p12: Buffer;
  passphrase: string;
  meta: CompleteMeta;
};

export type CompleteEnvelopeResult = {
  sealed: Uint8Array;
  certificate: Uint8Array;
  sha256: string;
};

export async function completeEnvelopePdf({
  original,
  appearance,
  p12,
  passphrase,
  meta,
}: CompleteEnvelopeInput): Promise<CompleteEnvelopeResult> {
  const withPage = await appendSignaturePage(original, appearance);
  const sealed = await sealPdf(withPage, p12, passphrase);
  const sha256 = sha256Hex(sealed);
  const certificate = await buildCertificate({ ...meta, sha256 });
  return { sealed, certificate, sha256 };
}
