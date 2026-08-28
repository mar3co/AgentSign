import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { aiDetectFields, parseAiFields } from "../lib/pdf/aiDetect.js";
import { DetectBlockedError, postDetectFields } from "../routes/detect.js";
import { resetEnvCache } from "../env.js";
import type { AuthAdapter } from "../lib/auth/supabase.js";
import { resetDeps, setDeps } from "../lib/deps.js";

function authedDeps(userId = "u1") {
  const adapter: AuthAdapter = {
    sendMagicLink: async () => {},
    signInWithPassword: async () => ({
      ok: false,
      error: "no",
      code: "invalid_credentials",
    }),
    signUp: async () => ({ ok: true }),
    startOAuth: async ({ redirectTo }) => ({ url: redirectTo }),
    userFromCookie: async (header) =>
      header ? { id: userId, email: "u@example.com" } : null,
    exchangeCode: async () => null,
  };
  setDeps({ auth: adapter });
}

function detectRequest(bytes: Uint8Array): Request {
  const body = new FormData();
  body.set("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), "doc.pdf");
  return new Request("http://test/v1/detect-fields", {
    method: "POST",
    headers: { cookie: "sign_session=tok" },
    body,
  });
}

async function simplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Signature: ____________", { x: 72, y: 700, size: 12, font });
  return doc.save();
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
  resetDeps();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("parseAiFields", () => {
  it("parses a JSON array, clamps areas, and names fields ai_*", () => {
    const fields = parseAiFields(
      JSON.stringify([
        { type: "signature", page: 1, x: 10, y: 95, w: 22, h: 30 },
        { type: "date", page: 1, x: 50, y: 50, w: 14, h: 3.5 },
      ]),
    );
    expect(fields.map((f) => f.name)).toEqual(["ai_signature_1", "ai_date_1"]);
    const sig = fields[0]!.areas[0]!;
    expect(sig.y + sig.h).toBeLessThanOrEqual(100);
    expect(fields[0]!.required).toBe(true);
  });

  it("accepts a fenced code block", () => {
    const fields = parseAiFields(
      '```json\n[{"type":"text","page":2,"x":5,"y":5,"w":10,"h":4}]\n```',
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]!.areas[0]!.page).toBe(2);
  });

  it("returns no fields for prose or invalid shapes", () => {
    expect(parseAiFields("Sorry, I cannot do that.")).toEqual([]);
    expect(parseAiFields('[{"type":"payment","page":1,"x":1,"y":1,"w":1,"h":1}]')).toEqual([]);
  });
});

describe("aiDetectFields", () => {
  it("skips the model call when the PDF has no text", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const generate = vi.fn(async () => "[]");
    const fields = await aiDetectFields(await doc.save(), generate);
    expect(fields).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });

  it("sends the text digest and drops out-of-range pages", async () => {
    const bytes = await simplePdf();
    let prompt = "";
    const fields = await aiDetectFields(bytes, async (p) => {
      prompt = p;
      return JSON.stringify([
        { type: "signature", page: 1, x: 10, y: 88, w: 22, h: 5 },
        { type: "date", page: 9, x: 10, y: 10, w: 14, h: 3.5 },
      ]);
    });
    expect(prompt).toContain("Signature: ____________");
    expect(fields.map((f) => f.type)).toEqual(["signature"]);
  });
});

describe("postDetectFields", () => {
  it("404s when the flag is off", async () => {
    const res = await postDetectFields(
      new Request("http://test/v1/detect-fields", { method: "POST" }),
      async () => "[]",
    );
    expect(res.status).toBe(404);
  });

  it("requires auth when the flag is on", async () => {
    vi.stubEnv("SIGN_FLAG_AI_FIELD_DETECT", "1");
    resetEnvCache();
    const res = await postDetectFields(
      new Request("http://test/v1/detect-fields", { method: "POST" }),
      async () => "[]",
    );
    expect(res.status).toBe(401);
  });

  it("503s when ANTHROPIC_API_KEY is not configured", async () => {
    vi.stubEnv("SIGN_FLAG_AI_FIELD_DETECT", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    resetEnvCache();
    authedDeps();
    const res = await postDetectFields(detectRequest(await simplePdf()), async () => "[]");
    expect(res.status).toBe(503);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("not_configured");
  });

  it("returns detected fields for an authenticated request", async () => {
    vi.stubEnv("SIGN_FLAG_AI_FIELD_DETECT", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    resetEnvCache();
    // Unique user ids per test: the limiter's map is module-global state.
    authedDeps("happy-user");
    const res = await postDetectFields(detectRequest(await simplePdf()), async () =>
      JSON.stringify([{ type: "signature", page: 1, x: 10, y: 88, w: 22, h: 5 }]),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { fields: { name: string }[] };
    expect(json.fields.map((f) => f.name)).toEqual(["ai_signature_1"]);
  });

  it("400s for bytes that are not a PDF", async () => {
    vi.stubEnv("SIGN_FLAG_AI_FIELD_DETECT", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    resetEnvCache();
    authedDeps("bad-file-user");
    const res = await postDetectFields(
      detectRequest(new TextEncoder().encode("not a pdf")),
      async () => "[]",
    );
    expect(res.status).toBe(400);
  });

  it("502s distinctly when the model blocks or truncates", async () => {
    vi.stubEnv("SIGN_FLAG_AI_FIELD_DETECT", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    resetEnvCache();
    authedDeps("blocked-user");
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await postDetectFields(detectRequest(await simplePdf()), async () => {
      throw new DetectBlockedError("unusable model reply: refusal");
    });
    expect(warned).toHaveBeenCalled();
    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("The AI couldn't process this document");
  });

  it("429s after too many model calls, then frees up after the window", { timeout: 120_000 }, async () => {
    vi.stubEnv("SIGN_FLAG_AI_FIELD_DETECT", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    resetEnvCache();
    authedDeps("rate-limit-user");
    // Fake only Date so the limiter's clock moves without stalling pdfjs.
    vi.useFakeTimers({ toFake: ["Date"] });
    const bytes = await simplePdf();
    const make = () => postDetectFields(detectRequest(bytes), async () => "[]");
    for (let i = 0; i < 10; i++) {
      expect((await make()).status).toBe(200);
    }
    const res = await make();
    expect(res.status).toBe(429);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("rate_limited");

    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1000);
    expect((await make()).status).toBe(200);
  });

  it("does not count requests rejected before the model call", async () => {
    vi.stubEnv("SIGN_FLAG_AI_FIELD_DETECT", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    resetEnvCache();
    authedDeps("not-configured-user");
    const make = () =>
      postDetectFields(
        new Request("http://test/v1/detect-fields", {
          method: "POST",
          headers: { cookie: "sign_session=tok" },
        }),
        async () => "[]",
      );
    // A missing key 503s every time; it must never flip into a 429.
    for (let i = 0; i < 11; i++) {
      expect((await make()).status).toBe(503);
    }
  });

  it("502s and logs when the model call fails", async () => {
    vi.stubEnv("SIGN_FLAG_AI_FIELD_DETECT", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    resetEnvCache();
    authedDeps("api-down-user");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postDetectFields(detectRequest(await simplePdf()), async () => {
      throw new Error("api down");
    });
    expect(res.status).toBe(502);
    expect(logged).toHaveBeenCalled();
  });
});
