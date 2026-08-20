import { describe, expect, it } from "vitest";
import { resetEnvCache } from "../env.js";
import { sessionCookieAttrs } from "../lib/auth/supabase.js";
import { loadSigningP12 } from "../lib/pdf/devP12.js";

describe("production P12 and session cookie flags", () => {
  it("loadSigningP12 throws when P12_PATH is empty outside tests", () => {
    const prevVitest = process.env.VITEST;
    const prevNode = process.env.NODE_ENV;
    const prevPath = process.env.P12_PATH;
    delete process.env.VITEST;
    process.env.NODE_ENV = "production";
    process.env.P12_PATH = "";
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
