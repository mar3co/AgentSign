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
    { name: "commonName", value: "Sign dev" },
    { name: "organizationName", value: "Sign" },
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

/** Production sets P12_PATH; otherwise generate a throwaway dev cert. */
export function loadSigningP12(): { p12: Buffer; passphrase: string } {
  const env = getEnv();
  if (env.P12_PATH) {
    return {
      p12: readFileSync(env.P12_PATH),
      passphrase: env.P12_PASSPHRASE,
    };
  }
  const passphrase = env.P12_PASSPHRASE || "dev";
  return { p12: makeDevP12(passphrase), passphrase };
}
