import { readFileSync } from "node:fs";
import forge from "node-forge";
import { getEnv } from "../../env.js";

/** RSA-2048 self-signed PKCS#12; passphrase must match P12Signer. */
export function makeDevP12(passphrase: string): Buffer {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: "commonName", value: "AgentSign dev" },
    { name: "organizationName", value: "AgentSign" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    {
      name: "keyUsage",
      keyCertSign: true,
      digitalSignature: true,
      nonRepudiation: true,
    },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Passworded bag → pkcs8ShroudedKeyBag, which P12Signer requires.
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [cert],
    passphrase,
  );
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  return Buffer.from(der, "binary");
}

function allowDevP12(): boolean {
  if (process.env.VERCEL) return false;
  if (process.env.VITEST) return true;
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return false;
}

/**
 * Production sets P12_BASE64 (Vercel has no file to point P12_PATH at) or
 * P12_PATH (self-host); tests may generate a throwaway cert.
 */
export function loadSigningP12(): { p12: Buffer; passphrase: string } {
  const env = getEnv();
  const base64 = env.P12_BASE64.trim();
  const path = env.P12_PATH.trim();
  if (base64) {
    return checked(Buffer.from(base64, "base64"), env.P12_PASSPHRASE, "P12_BASE64");
  }
  if (path) {
    return checked(readFileSync(path), env.P12_PASSPHRASE, "P12_PATH");
  }
  if (!allowDevP12()) {
    throw new Error("P12_BASE64 or P12_PATH is required");
  }
  const passphrase = env.P12_PASSPHRASE || "dev";
  return { p12: makeDevP12(passphrase), passphrase };
}

/**
 * Buffer.from(_, "base64") never throws, so a value cut short in a dashboard
 * would otherwise surface only as a generic failure on every Finish. Parse it
 * once here and name the variable.
 */
function checked(
  p12: Buffer,
  passphrase: string,
  source: string,
): { p12: Buffer; passphrase: string } {
  try {
    forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12.toString("binary")), false, passphrase);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${source} is not a PKCS#12 file for P12_PASSPHRASE: ${reason}`);
  }
  return { p12, passphrase };
}
