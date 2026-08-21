import { randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { sha256Hex } from "./hash.js";

export function hashSigningToken(raw: string): string {
  return sha256Hex(raw);
}

export function newSigningToken(): { raw: string; hash: string } {
  const raw = nanoid(21);
  return { raw, hash: hashSigningToken(raw) };
}

/** Hash with no corresponding raw token — pre-invite placeholder, not a URL. */
export function placeholderSigningTokenHash(): string {
  return sha256Hex(randomBytes(32).toString("hex"));
}

function newPrefixedSecret(tag: string): {
  raw: string;
  prefix: string;
  hash: string;
} {
  const raw = tag + randomBytes(32).toString("hex");
  return {
    raw,
    prefix: raw.slice(0, 12),
    hash: sha256Hex(raw),
  };
}

export function newTmpKey(): { raw: string; prefix: string; hash: string } {
  return newPrefixedSecret("sign_tmp_");
}

export function newLiveKey(): { raw: string; prefix: string; hash: string } {
  return newPrefixedSecret("sign_live_");
}

export function newAgentKey(): { raw: string; prefix: string; hash: string } {
  return newPrefixedSecret("sign_agent_");
}

export function newOauthToken(): { raw: string; prefix: string; hash: string } {
  return newPrefixedSecret("sign_oauth_");
}
