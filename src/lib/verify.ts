import { createHash, timingSafeEqual } from "node:crypto";
import forge from "node-forge";
import { getDeps } from "./deps.js";
import { sha256Hex } from "./hash.js";
import { loadSigningP12 } from "./pdf/devP12.js";

export type VerifyResult = {
  valid: boolean;
  code?: string;
  sha256?: string;
  document_id?: string;
  human_signatures?: number;
  agent_attestations?: number;
  parties?: Array<{
    kind: string;
    email: string;
    signed_at?: string;
    attested_at?: string;
  }>;
};

const AGENT_RE =
  /^Attested by .+ for (\S+) at (\d{4}-\d{2}-\d{2}T[^\s]+)\. Not an electronic signature\.$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z$/;
const DOCUMENT_RE =
  /^Document id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const HUMAN_COUNT_RE = /^human_signatures: (\d+)$/;
const AGENT_COUNT_RE = /^agent_attestations: (\d+)$/;
const MESSAGE_DIGEST_OID = "1.2.840.113549.1.9.4";

const fromDer = forge.asn1.fromDer as (
  bytes: string,
  options?: boolean | { parseAllBytes?: boolean; strict?: boolean },
) => forge.asn1.Asn1;

function signingP12(): { p12: Buffer; passphrase: string } {
  const deps = getDeps();
  if (deps.p12 && deps.p12Passphrase != null) {
    return { p12: deps.p12, passphrase: deps.p12Passphrase };
  }
  return loadSigningP12();
}

function notOurSeal(): VerifyResult {
  return { valid: false, code: "not_our_seal" };
}

function nodes(node: forge.asn1.Asn1): forge.asn1.Asn1[] {
  return Array.isArray(node.value) ? node.value : [];
}

function p12Certificate(
  p12Der: Buffer,
  passphrase: string,
): forge.pki.Certificate | null {
  try {
    const asn1 = fromDer(p12Der.toString("binary"), { parseAllBytes: false });
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ];
    return bags?.[0]?.cert ?? null;
  } catch {
    return null;
  }
}

function publicKeyEqual(
  a: forge.pki.Certificate,
  b: forge.pki.Certificate,
): boolean {
  const ap = a.publicKey as forge.pki.rsa.PublicKey;
  const bp = b.publicKey as forge.pki.rsa.PublicKey;
  if (!ap.n || !bp.n) return false;
  return ap.n.compareTo(bp.n) === 0 && ap.e.compareTo(bp.e) === 0;
}

function parseByteRanges(
  pdf: Buffer,
): [number, number, number, number][] {
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const latin1 = pdf.toString("latin1");
  const out: [number, number, number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin1))) {
    const br: [number, number, number, number] = [
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
    ];
    if (br.some((n) => !Number.isFinite(n) || n < 0)) continue;
    if (br[0] !== 0 || br[2] + br[3] !== pdf.length) continue;
    if (br[0] + br[1] > pdf.length) continue;
    out.push(br);
  }
  return out;
}

function cmsFromPdf(
  pdf: Buffer,
  br: [number, number, number, number],
): Buffer | null {
  if (pdf[br[1]] !== 0x3c || pdf[br[2] - 1] !== 0x3e) return null;
  const hex = pdf
    .subarray(br[1] + 1, br[2] - 1)
    .toString("latin1")
    .replace(/[^0-9a-fA-F]/g, "");
  if (hex.length < 2 || hex.length % 2 !== 0) return null;
  const raw = Buffer.from(hex, "hex");
  try {
    const asn1 = fromDer(raw.toString("binary"), { parseAllBytes: false });
    return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
  } catch {
    return null;
  }
}

function equalDigest(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function verifySignerInfo(
  info: forge.asn1.Asn1,
  signedBytes: Buffer,
  ourCert: forge.pki.Certificate,
): boolean {
  const fields = nodes(info);
  let attrs: forge.asn1.Asn1 | undefined;
  let signature: forge.asn1.Asn1 | undefined;
  for (const f of fields) {
    if (f.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && f.type === 0) {
      attrs = f;
    }
    if (
      f.tagClass === forge.asn1.Class.UNIVERSAL &&
      f.type === forge.asn1.Type.OCTETSTRING
    ) {
      signature = f;
    }
  }
  if (!attrs || !signature || typeof signature.value !== "string") return false;

  let messageDigest: string | undefined;
  for (const attr of nodes(attrs)) {
    const av = nodes(attr);
    if (av.length < 2 || typeof av[0]!.value !== "string") continue;
    let oid: string;
    try {
      oid = forge.asn1.derToOid(av[0]!.value);
    } catch {
      continue;
    }
    if (oid !== MESSAGE_DIGEST_OID && oid !== forge.pki.oids.messageDigest) {
      continue;
    }
    const oct = nodes(av[1]!)[0];
    if (oct && typeof oct.value === "string") messageDigest = oct.value;
  }
  if (!messageDigest) return false;

  const contentDigest = createHash("sha256").update(signedBytes).digest();
  const attrDigest = Buffer.from(messageDigest, "binary");
  if (!equalDigest(contentDigest, attrDigest)) return false;

  const attrsSet = forge.asn1.create(
    forge.asn1.Class.UNIVERSAL,
    forge.asn1.Type.SET,
    true,
    nodes(attrs),
  );
  const attrsDer = Buffer.from(forge.asn1.toDer(attrsSet).getBytes(), "binary");
  const md = forge.md.sha256.create();
  md.update(attrsDer.toString("binary"), "raw");
  const pub = ourCert.publicKey as forge.pki.rsa.PublicKey;
  try {
    return pub.verify(md.digest().bytes(), signature.value);
  } catch {
    return false;
  }
}

function ourSealHolds(bytes: Uint8Array): boolean {
  let p12: Buffer;
  let passphrase: string;
  try {
    ({ p12, passphrase } = signingP12());
  } catch {
    return false;
  }
  const ourCert = p12Certificate(p12, passphrase);
  if (!ourCert) return false;

  const pdf = Buffer.from(bytes);
  const ranges = parseByteRanges(pdf);
  for (let i = ranges.length - 1; i >= 0; i--) {
    const br = ranges[i]!;
    const signedBytes = Buffer.concat([
      pdf.subarray(br[0], br[0] + br[1]),
      pdf.subarray(br[2], br[2] + br[3]),
    ]);
    const cms = cmsFromPdf(pdf, br);
    if (!cms) continue;
    try {
      const p7Asn1 = fromDer(cms.toString("binary"), { parseAllBytes: false });
      const p7 = forge.pkcs7.messageFromAsn1(p7Asn1);
      const certs = "certificates" in p7 ? p7.certificates : [];
      if (!certs.some((c) => publicKeyEqual(c, ourCert))) continue;

      const explicit = nodes(p7Asn1)[1];
      if (!explicit) continue;
      const signedData = nodes(explicit)[0];
      if (!signedData) continue;
      const children = nodes(signedData);
      const signerInfos = children[children.length - 1];
      if (!signerInfos) continue;
      if (
        nodes(signerInfos).some((info) =>
          verifySignerInfo(info, signedBytes, ourCert),
        )
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

function unescapePdf(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([()\\])/g, "$1");
}

function pdfStrings(bytes: Uint8Array): string[] {
  const latin1 = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin1))) {
    out.push(unescapePdf(m[0]!.slice(1, -1)));
  }
  return out;
}

function parseDrawnText(bytes: Uint8Array): {
  document_id?: string;
  human_signatures?: number;
  agent_attestations?: number;
  parties: VerifyResult["parties"];
} {
  const strings = pdfStrings(bytes);
  let lastId: string | undefined;
  for (const raw of strings) {
    const found = DOCUMENT_RE.exec(raw);
    if (found) lastId = found[1];
  }
  const start =
    lastId === undefined
      ? 0
      : strings.findIndex((raw) => DOCUMENT_RE.exec(raw)?.[1] === lastId);
  const scoped = start >= 0 ? strings.slice(start) : strings;

  const parties: NonNullable<VerifyResult["parties"]> = [];
  let document_id: string | undefined;
  let human_signatures: number | undefined;
  let agent_attestations: number | undefined;

  for (let i = 0; i < scoped.length; i++) {
    const s = scoped[i]!;
    const env = DOCUMENT_RE.exec(s);
    if (env) {
      document_id = env[1]!;
      continue;
    }
    const hc = HUMAN_COUNT_RE.exec(s);
    if (hc) {
      human_signatures = Number(hc[1]);
      continue;
    }
    const ac = AGENT_COUNT_RE.exec(s);
    if (ac) {
      agent_attestations = Number(ac[1]);
      continue;
    }
    const agent = AGENT_RE.exec(s);
    if (agent) {
      parties.push({
        kind: "agent",
        email: agent[1]!,
        attested_at: agent[2],
      });
      continue;
    }
    if (
      EMAIL_RE.test(s) &&
      i + 1 < scoped.length &&
      ISO_RE.test(scoped[i + 1]!)
    ) {
      parties.push({
        kind: "human",
        email: s,
        signed_at: scoped[i + 1],
      });
    }
  }

  const unique = new Map<string, (typeof parties)[number]>();
  for (const p of parties) {
    unique.set(`${p.kind}:${p.email}:${p.signed_at ?? p.attested_at ?? ""}`, p);
  }
  const deduped = [...unique.values()];
  return {
    document_id,
    human_signatures: human_signatures ?? deduped.filter((p) => p.kind === "human").length,
    agent_attestations:
      agent_attestations ?? deduped.filter((p) => p.kind === "agent").length,
    parties: deduped,
  };
}

export async function verifySealedPdf(bytes: Uint8Array): Promise<VerifyResult> {
  if (!ourSealHolds(bytes)) return notOurSeal();
  const drawn = parseDrawnText(bytes);
  return {
    valid: true,
    sha256: sha256Hex(bytes),
    document_id: drawn.document_id,
    human_signatures: drawn.human_signatures,
    agent_attestations: drawn.agent_attestations,
    parties: drawn.parties,
  };
}
