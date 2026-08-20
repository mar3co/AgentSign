import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

export function GET(): Response {
  const text = readFileSync(join(process.cwd(), "public/llms.txt"), "utf8");
  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
