import { describe, expect, it } from "vitest";
import { POST as postVerify } from "../../app/v1/verify/route.js";

function verifyRequest(body: Uint8Array, ip: string): Request {
  return new Request("http://sign.test/v1/verify", {
    method: "POST",
    headers: { "content-type": "application/pdf", "x-real-ip": ip },
    body: Buffer.from(body),
  });
}

describe("POST /v1/verify limits", () => {
  it("rejects a body over the PDF size cap", async () => {
    const oversized = new Uint8Array(20 * 1024 * 1024 + 1);
    const res = await postVerify(verifyRequest(oversized, "203.0.113.30"));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("file_too_large");
  });

  it("rejects a declared body size over the cap before reading it", async () => {
    const res = await postVerify(
      new Request("http://sign.test/v1/verify", {
        method: "POST",
        headers: {
          "content-type": "application/pdf",
          "content-length": String(20 * 1024 * 1024 + 1),
          "x-real-ip": "203.0.113.33",
        },
        body: Buffer.from("tiny"),
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("file_too_large");
  });

  it("rate limits verify per client IP", async () => {
    const junk = new TextEncoder().encode("not a pdf");
    for (let i = 0; i < 30; i++) {
      const res = await postVerify(verifyRequest(junk, "203.0.113.31"));
      expect(res.status).not.toBe(429);
    }
    const limited = await postVerify(verifyRequest(junk, "203.0.113.31"));
    expect(limited.status).toBe(429);
    const json = (await limited.json()) as { code: string };
    expect(json.code).toBe("rate_limited");

    const other = await postVerify(verifyRequest(junk, "203.0.113.32"));
    expect(other.status).not.toBe(429);
  });
});
