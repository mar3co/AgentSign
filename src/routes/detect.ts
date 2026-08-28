import { getEnv } from "../env.js";
import { getAuth } from "../lib/auth/supabase.js";
import { flagOn } from "../lib/flags.js";
import { aiDetectFields } from "../lib/pdf/aiDetect.js";
import { slidingWindowLimiter } from "../lib/rateLimit.js";

const PDF_MAX_BYTES = 20 * 1024 * 1024;

// Each request is a paid model call, so cap how fast one user can burn them.
const rateLimited = slidingWindowLimiter(10, 10 * 60 * 1000);

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

/** The model declined or its reply was cut off — not a fact about the document. */
export class DetectBlockedError extends Error {}

async function claudeGenerate(prompt: string): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });
  if (
    response.stop_reason === "refusal" ||
    response.stop_reason === "max_tokens"
  ) {
    throw new DetectBlockedError(`unusable model reply: ${response.stop_reason}`);
  }
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** POST /v1/detect-fields — AI field suggestions for an uploaded PDF. */
export async function postDetectFields(
  req: Request,
  generate: (prompt: string) => Promise<string> = claudeGenerate,
): Promise<Response> {
  if (!(await flagOn("ai_field_detect"))) {
    return jsonError(404, "Not found", "not_found");
  }
  const user = await getAuth().userFromCookie(req.headers.get("cookie"));
  if (!user) return jsonError(401, "Unauthorized", "unauthorized");
  if (!getEnv().ANTHROPIC_API_KEY.trim()) {
    return jsonError(503, "AI detection is not configured", "not_configured");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Expected multipart form data", "invalid_request");
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return jsonError(400, "A PDF file is required", "invalid_pdf");
  }
  if (file.size > PDF_MAX_BYTES) {
    return jsonError(400, "PDF exceeds maximum size", "file_too_large");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Checked last so cheap rejections (flag, auth, key, malformed form)
  // never count against the cap. A file that fails to parse still counts:
  // the parse itself is work worth capping.
  if (rateLimited(user.id)) {
    return jsonError(
      429,
      "Too many detection requests. Try again in a few minutes.",
      "rate_limited",
    );
  }

  try {
    const fields = await aiDetectFields(bytes, generate);
    return Response.json({ fields });
  } catch (err) {
    if (err instanceof Error && err.message === "invalid_pdf") {
      return jsonError(400, "File must be a PDF", "invalid_pdf");
    }
    if (err instanceof DetectBlockedError) {
      // Not an outage, but operators should see refusal/truncation rates.
      console.warn("detect-fields blocked:", err.message);
      return jsonError(
        502,
        "The AI couldn't process this document",
        "detect_failed",
      );
    }
    console.error("detect-fields failed:", err);
    return jsonError(502, "Detection failed", "detect_failed");
  }
}
