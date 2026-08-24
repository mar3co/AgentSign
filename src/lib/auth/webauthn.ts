/** Browser WebAuthn helpers. Safe to import from client components. */

export function supportsWebAuthn(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator.credentials?.create === "function" &&
    typeof navigator.credentials?.get === "function"
  );
}

export function isWebAuthnCancel(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "NotAllowedError" || name === "AbortError";
}

export async function createPasskey(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const publicKey = parseCreation(options);
  const cred = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey was not created");
  return serializeCreation(cred);
}

export async function getPasskey(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const publicKey = parseRequest(options);
  const cred = (await navigator.credentials.get({
    publicKey,
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey was not found");
  return serializeRequest(cred);
}

function parseCreation(
  options: Record<string, unknown>,
): PublicKeyCredentialCreationOptions {
  const pkc = window.PublicKeyCredential as unknown as {
    parseCreationOptionsFromJSON?: (
      o: unknown,
    ) => PublicKeyCredentialCreationOptions;
  };
  if (typeof pkc.parseCreationOptionsFromJSON === "function") {
    return pkc.parseCreationOptionsFromJSON(options);
  }
  const user = options.user as Record<string, unknown>;
  const exclude = options.excludeCredentials as
    | Array<Record<string, unknown>>
    | undefined;
  return {
    ...(options as unknown as PublicKeyCredentialCreationOptions),
    challenge: b64urlToBuffer(String(options.challenge)),
    user: {
      ...(user as unknown as PublicKeyCredentialUserEntity),
      id: b64urlToBuffer(String(user.id)),
    },
    excludeCredentials: exclude?.map((c) => ({
      ...(c as unknown as PublicKeyCredentialDescriptor),
      id: b64urlToBuffer(String(c.id)),
    })),
  };
}

function parseRequest(
  options: Record<string, unknown>,
): PublicKeyCredentialRequestOptions {
  const pkc = window.PublicKeyCredential as unknown as {
    parseRequestOptionsFromJSON?: (
      o: unknown,
    ) => PublicKeyCredentialRequestOptions;
  };
  if (typeof pkc.parseRequestOptionsFromJSON === "function") {
    return pkc.parseRequestOptionsFromJSON(options);
  }
  const allow = options.allowCredentials as
    | Array<Record<string, unknown>>
    | undefined;
  return {
    ...(options as unknown as PublicKeyCredentialRequestOptions),
    challenge: b64urlToBuffer(String(options.challenge)),
    allowCredentials: allow?.map((c) => ({
      ...(c as unknown as PublicKeyCredentialDescriptor),
      id: b64urlToBuffer(String(c.id)),
    })),
  };
}

function serializeCreation(cred: PublicKeyCredential): Record<string, unknown> {
  if (typeof cred.toJSON === "function") return cred.toJSON() as Record<string, unknown>;
  const att = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: cred.id,
    type: "public-key",
    response: {
      attestationObject: bufferToB64url(att.attestationObject),
      clientDataJSON: bufferToB64url(att.clientDataJSON),
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}

function serializeRequest(cred: PublicKeyCredential): Record<string, unknown> {
  if (typeof cred.toJSON === "function") return cred.toJSON() as Record<string, unknown>;
  const asrt = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: cred.id,
    type: "public-key",
    response: {
      authenticatorData: bufferToB64url(asrt.authenticatorData),
      clientDataJSON: bufferToB64url(asrt.clientDataJSON),
      signature: bufferToB64url(asrt.signature),
      userHandle: asrt.userHandle ? bufferToB64url(asrt.userHandle) : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
  };
}

function b64urlToBuffer(s: string): ArrayBuffer {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function bufferToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
