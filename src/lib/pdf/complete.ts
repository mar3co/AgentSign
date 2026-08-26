import { sha256Hex } from "../hash.js";
import {
  appendSignaturePage,
  type SignatureAppearance,
} from "./appendSignaturePage.js";
import { burnFields, type BurnParty } from "./burnFields.js";
import { buildCertificate, type CertificateInfo } from "./certificate.js";
import type { DocumentField } from "./fields.js";
import { sealPdf } from "./seal.js";

export type CompleteMeta = Omit<CertificateInfo, "sha256">;

export type CompleteDocumentInput = {
  original: Uint8Array;
  appearance?: SignatureAppearance;
  appearances?: SignatureAppearance[];
  fields?: DocumentField[];
  fieldParties?: BurnParty[];
  p12: Buffer;
  passphrase: string;
  meta: CompleteMeta;
};

export type CompleteDocumentResult = {
  sealed: Uint8Array;
  certificate: Uint8Array;
  sha256: string;
};

function stampAppearance(
  next: SignatureAppearance,
  meta: CompleteMeta,
  banner: string | undefined,
  humanSignatures: number,
  agentAttestations: number,
): SignatureAppearance {
  return {
    ...next,
    documentId: next.documentId ?? meta.documentId,
    banner: next.banner ?? banner,
    humanSignatures: next.humanSignatures ?? humanSignatures,
    agentAttestations: next.agentAttestations ?? agentAttestations,
  };
}

export async function completeDocumentPdf({
  original,
  appearance,
  appearances,
  fields,
  fieldParties,
  p12,
  passphrase,
  meta,
}: CompleteDocumentInput): Promise<CompleteDocumentResult> {
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
  if (fields && fields.length > 0) {
    withPage = await burnFields(original, {
      fields,
      parties: fieldParties ?? [],
    });
    const rolesWithSignature = new Set(
      fields.filter((f) => f.type === "signature").map((f) => f.role),
    );
    const parties = fieldParties ?? [];
    for (const party of parties) {
      if (party.kind !== "human") continue;
      if (rolesWithSignature.has(party.role)) continue;
      const matched = pages.find(
        (p) =>
          (p.kind ?? "human") !== "agent" &&
          p.email === party.email &&
          p.name === party.name,
      );
      const next: SignatureAppearance = {
        png: matched?.png,
        name: party.name,
        email: party.email,
        signedAt: party.signedAt ?? matched?.signedAt ?? new Date(),
        kind: "human",
      };
      withPage = await appendSignaturePage(
        withPage,
        stampAppearance(next, meta, banner, humanSignatures, agentAttestations),
      );
    }
  } else {
    for (const next of pages) {
      withPage = await appendSignaturePage(
        withPage,
        stampAppearance(next, meta, banner, humanSignatures, agentAttestations),
      );
    }
  }

  const sealed = await sealPdf(withPage, p12, passphrase);
  const sha256 = sha256Hex(sealed);
  const certificate = await buildCertificate({ ...meta, sha256 });
  return { sealed, certificate, sha256 };
}
