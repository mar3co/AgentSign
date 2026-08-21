import { LOGO_MAX_BYTES } from "./entitlement.js";

export function brandingKey(ownerUserId: string): string {
  return `branding/${ownerUserId}/logo`;
}

export function parseLogo(
  bytes: Uint8Array,
): { ok: true; contentType: "image/png" | "image/jpeg" } | { ok: false } {
  if (bytes.length === 0 || bytes.length > LOGO_MAX_BYTES) return { ok: false };
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { ok: true, contentType: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, contentType: "image/jpeg" };
  }
  return { ok: false };
}
