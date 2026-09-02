import { clientIp } from "../lib/clientIp.js";
import { slidingWindowLimiter } from "../lib/rateLimit.js";
import { verifySealedPdf } from "../lib/verify.js";

const PDF_MAX_BYTES = 20 * 1024 * 1024;

// Verify is public and parses whatever it is handed (PDF, then PKCS#7), so
// cap how fast one client can make this instance do that work.
const rateLimited = slidingWindowLimiter(30, 10 * 60 * 1000);

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

class BodyTooLargeError extends Error {}

async function readPdfBytes(req: Request): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > PDF_MAX_BYTES) throw new BodyTooLargeError();

  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    try {
      const form = await req.formData();
      for (const value of form.values()) {
        if (value instanceof Blob) {
          if (value.size > PDF_MAX_BYTES) throw new BodyTooLargeError();
          const bytes = new Uint8Array(await value.arrayBuffer());
          if (bytes.byteLength > 0) return bytes;
        }
      }
    } catch (err) {
      if (err instanceof BodyTooLargeError) throw err;
      return null;
    }
    return null;
  }
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > PDF_MAX_BYTES) throw new BodyTooLargeError();
    return bytes.byteLength > 0 ? bytes : null;
  } catch (err) {
    if (err instanceof BodyTooLargeError) throw err;
    return null;
  }
}

export async function verifyDocument(req: Request): Promise<Response> {
  if (rateLimited(clientIp(req))) {
    return jsonError(429, "Too many requests. Try again later.", "rate_limited");
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await readPdfBytes(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return jsonError(400, "File exceeds maximum size", "file_too_large");
    }
    throw err;
  }
  if (!bytes) {
    return jsonError(400, "A PDF is required", "invalid_request");
  }
  const result = await verifySealedPdf(bytes);
  return Response.json(result);
}
