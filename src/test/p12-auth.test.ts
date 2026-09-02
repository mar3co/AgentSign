import { describe, expect, it } from "vitest";
import { resetEnvCache } from "../env.js";
import { sessionCookieAttrs } from "../lib/auth/supabase.js";
import { loadSigningP12, makeDevP12 } from "../lib/pdf/devP12.js";

describe("production P12 and session cookie flags", () => {
  it("loadSigningP12 throws when P12_BASE64 and P12_PATH are blank outside tests", () => {
    const prevVitest = process.env.VITEST;
    const prevNode = process.env.NODE_ENV;
    const prevPath = process.env.P12_PATH;
    const prevBase64 = process.env.P12_BASE64;
    delete process.env.VITEST;
    process.env.NODE_ENV = "production";
    process.env.P12_PATH = " ";
    process.env.P12_BASE64 = "";
    resetEnvCache();
    try {
      expect(() => loadSigningP12()).toThrow(/P12_PATH/);
    } finally {
      if (prevVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = prevVitest;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevPath === undefined) delete process.env.P12_PATH;
      else process.env.P12_PATH = prevPath;
      if (prevBase64 === undefined) delete process.env.P12_BASE64;
      else process.env.P12_BASE64 = prevBase64;
      resetEnvCache();
    }
  });

  it("loadSigningP12 mints a throwaway cert in next dev when P12_PATH is empty", () => {
    const prevVitest = process.env.VITEST;
    const prevNode = process.env.NODE_ENV;
    const prevPath = process.env.P12_PATH;
    const prevVercel = process.env.VERCEL;
    delete process.env.VITEST;
    delete process.env.VERCEL;
    process.env.NODE_ENV = "development";
    process.env.P12_PATH = "";
    resetEnvCache();
    try {
      const loaded = loadSigningP12();
      expect(loaded.p12.byteLength).toBeGreaterThan(0);
      expect(loaded.passphrase).toBeTruthy();
    } finally {
      if (prevVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = prevVitest;
      if (prevNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNode;
      if (prevPath === undefined) delete process.env.P12_PATH;
      else process.env.P12_PATH = prevPath;
      if (prevVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prevVercel;
      resetEnvCache();
    }
  });

  it("loadSigningP12 decodes P12_BASE64 on Vercel production", () => {
    const saved = { ...process.env };
    const expected = makeDevP12("pw");
    delete process.env.VITEST;
    process.env.VERCEL = "1";
    process.env.NODE_ENV = "production";
    process.env.P12_PATH = "";
    process.env.P12_BASE64 = expected.toString("base64");
    process.env.P12_PASSPHRASE = "pw";
    resetEnvCache();
    try {
      const loaded = loadSigningP12();
      expect(Buffer.from(loaded.p12).equals(expected)).toBe(true);
      expect(loaded.passphrase).toBe("pw");
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
      resetEnvCache();
    }
  });

  it("loadSigningP12 rejects a truncated P12_BASE64 instead of decoding garbage", () => {
    const saved = { ...process.env };
    const whole = makeDevP12("pw").toString("base64");
    process.env.P12_PATH = "";
    process.env.P12_BASE64 = whole.slice(0, whole.length - 100);
    resetEnvCache();
    try {
      expect(() => loadSigningP12()).toThrow(/P12_BASE64/);
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
      resetEnvCache();
    }
  });

  it("session cookies are Secure when APP_URL is https", () => {
    const prev = process.env.APP_URL;
    process.env.APP_URL = "https://sign.example";
    resetEnvCache();
    try {
      expect(sessionCookieAttrs()).toMatch(/Secure/);
    } finally {
      if (prev === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prev;
      resetEnvCache();
    }
  });
});
