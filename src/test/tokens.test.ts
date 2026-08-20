import { describe, it, expect } from "vitest";
import { sha256Hex } from "../lib/hash.js";
import { newSigningToken, hashSigningToken, newTmpKey, newLiveKey } from "../lib/tokens.js";
import { newOtp, verifyOtp } from "../lib/otp.js";

describe("tokens", () => {
  it("hashes signing tokens; raw is not the hash", () => {
    const t = newSigningToken();
    expect(t.raw).toHaveLength(21);
    expect(t.hash).toBe(hashSigningToken(t.raw));
    expect(t.hash).not.toBe(t.raw);
  });

  it("creates a 6-digit OTP that verifies", async () => {
    const o = await newOtp();
    expect(o.digits).toMatch(/^\d{6}$/);
    expect(await verifyOtp(o.digits, o.hash)).toBe(true);
    expect(await verifyOtp("000000", o.hash)).toBe(false);
  });

  it("issues hashed tmp and live keys", () => {
    const tmp = newTmpKey();
    const live = newLiveKey();
    expect(tmp.raw.startsWith("sign_tmp_")).toBe(true);
    expect(live.raw.startsWith("sign_live_")).toBe(true);
    expect(tmp.hash).toBe(sha256Hex(tmp.raw));
    expect(live.hash).toBe(sha256Hex(live.raw));
  });
});
