import { describe, it, expect } from "vitest";
import { GET } from "../../app/health/route.js";

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await GET(new Request("http://sign.test/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
