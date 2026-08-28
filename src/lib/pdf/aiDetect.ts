import { z } from "zod";
import {
  defaultRequired,
  fieldTypes,
  type DocumentField,
} from "./fields.js";
import { groupRuns, locatePdfText, unionBox } from "./textRuns.js";

/**
 * AI-assisted field detection: the document's text is digested into lines
 * with percent coordinates, and the model proposes where fields belong.
 * Callers treat the result as suggestions.
 */

const MAX_LINES = 1500;
const MAX_AI_FIELDS = 50;

export function buildLineDigest(
  pages: Awaited<ReturnType<typeof locatePdfText>>,
): string {
  const lines: string[] = [];
  for (const { page, viewport, items } of pages) {
    for (const run of groupRuns(items)) {
      const text = run
        .map((r) => r.str)
        .join("")
        .trim();
      if (!text) continue;
      if (lines.length >= MAX_LINES) return lines.join("\n");
      const box = unionBox(run, viewport, page);
      lines.push(
        `p${page} y=${box.y.toFixed(1)} x=${box.x.toFixed(1)}-${(box.x + box.w).toFixed(1)} h=${box.h.toFixed(1)} | ${text}`,
      );
    }
  }
  return lines.join("\n");
}

export function detectPrompt(digest: string): string {
  return [
    "You are labeling where signers must fill in a document that will be sent for e-signature.",
    "Below is every text line of a PDF. Coordinates are percent of the page: y is measured from the top, x from the left, h is the line height.",
    "Propose fields (signature, initials, date, name, text, checkbox) positioned where a signer should write: on blanks, after labels like \"Signature:\", on underscore lines, in empty table cells next to labels.",
    "Only propose fields a signer must fill. Do not mark plain prose. Prefer fewer, confident fields.",
    "Respond with ONLY a JSON array, no prose, of objects:",
    '{"type":"signature|initials|date|name|text|checkbox","page":1,"x":10.0,"y":50.0,"w":22.0,"h":5.0}',
    "where x/y/w/h are the field box in percent of the page (y from top).",
    "",
    "Document:",
    digest,
  ].join("\n");
}

const aiFieldSchema = z.object({
  type: z.enum(fieldTypes),
  page: z.number().int().positive(),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().gt(0),
  h: z.number().finite().gt(0),
});

/** Parse the model's JSON reply into clamped suggestion fields. */
export function parseAiFields(raw: string): DocumentField[] {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const parsed = z.array(aiFieldSchema).safeParse(json);
  if (!parsed.success) return [];

  const counts = new Map<string, number>();
  return parsed.data.slice(0, MAX_AI_FIELDS).map((f) => {
    const w = Math.min(Math.max(f.w, 1), 100);
    const h = Math.min(Math.max(f.h, 1), 100);
    const n = (counts.get(f.type) ?? 0) + 1;
    counts.set(f.type, n);
    return {
      name: `ai_${f.type}_${n}`,
      type: f.type,
      role: "Signer 1",
      required: defaultRequired(f.type),
      readonly: false,
      areas: [
        {
          page: f.page,
          x: Math.min(Math.max(f.x, 0), 100 - w),
          y: Math.min(Math.max(f.y, 0), 100 - h),
          w,
          h,
        },
      ],
    };
  });
}

/**
 * Detect fields with a model. `generate` runs the prompt and returns the
 * model's text (injected so tests and callers control the client).
 */
export async function aiDetectFields(
  bytes: Uint8Array,
  generate: (prompt: string) => Promise<string>,
): Promise<DocumentField[]> {
  const pages = await locatePdfText(bytes);
  const digest = buildLineDigest(pages);
  if (!digest.trim()) return [];
  const reply = await generate(detectPrompt(digest));
  const fields = parseAiFields(reply);
  const pageCount = pages.length;
  return fields.filter((f) => f.areas.every((a) => a.page <= pageCount));
}
