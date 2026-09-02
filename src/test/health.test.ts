import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "../../app/health/route.js";
import { resetEnvCache } from "../env.js";

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  resetEnvCache();
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await GET(new Request("http://sign.test/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("reports missing production secrets with a 503 in Vercel production", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.FROM_EMAIL;
    resetEnvCache();
    const res = await GET(new Request("http://sign.test/health"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.missing).toContain("SUPABASE_ANON_KEY");
    expect(body.missing).toContain("RESEND_API_KEY");
    expect(body.missing).toContain("FROM_EMAIL");
    expect(body.missing).toContain("P12_BASE64 or P12_PATH");
  });
});
