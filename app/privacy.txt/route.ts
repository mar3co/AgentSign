import { PRIVACY_SECTIONS } from "../privacy/privacy-copy.js";

export const runtime = "nodejs";

export function GET(): Response {
  const text = PRIVACY_SECTIONS.map((s) => `# ${s.heading}\n\n${s.body}`).join(
    "\n\n",
  );
  return new Response(text, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
