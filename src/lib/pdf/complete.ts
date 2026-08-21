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
  appearance?: SignatureAppearance;
  appearances?: SignatureAppearance[];
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
  appearances,
  p12,
  passphrase,
  meta,
}: CompleteEnvelopeInput): Promise<CompleteEnvelopeResult> {
  const pages = appearances ?? (appearance ? [appearance] : []);
  if (pages.length === 0) {
    throw new Error("At least one signature appearance is required");
  }
  const humanSignatures = pages.filter(
    (p) => (p.kind ?? "human") !== "agent",
  ).length;
  const agentAttestations = pages.filter((p) => p.kind === "agent").length;
  const banner =
    humanSignatures === 0
      ? "No human electronic signature. Agent attestations only."
      : undefined;
  let withPage = original;
  for (const next of pages) {
    const stamped: SignatureAppearance = {
      ...next,
      envelopeId: next.envelopeId ?? meta.envelopeId,
      banner: next.banner ?? banner,
      humanSignatures: next.humanSignatures ?? humanSignatures,
      agentAttestations: next.agentAttestations ?? agentAttestations,
    };
    withPage = await appendSignaturePage(withPage, stamped);
  }
  const sealed = await sealPdf(withPage, p12, passphrase);
  const sha256 = sha256Hex(sealed);
  const certificate = await buildCertificate({ ...meta, sha256 });
  return { sealed, certificate, sha256 };
}
