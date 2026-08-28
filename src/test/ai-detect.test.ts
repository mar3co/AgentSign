import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { aiDetectFields, parseAiFields } from "../lib/pdf/aiDetect.js";
import { postDetectFields } from "../routes/detect.js";
import { resetEnvCache } from "../env.js";

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
});
