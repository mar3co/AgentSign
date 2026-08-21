import { verifySealedPdf } from "../lib/verify.js";

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

async function readPdfBytes(req: Request): Promise<Uint8Array | null> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    try {
      const form = await req.formData();
      for (const value of form.values()) {
        if (value instanceof Blob) {
          const bytes = new Uint8Array(await value.arrayBuffer());
          if (bytes.byteLength > 0) return bytes;
        }
      }
    } catch {
      return null;
    }
    return null;
  }
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    return bytes.byteLength > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export async function verifyEnvelope(req: Request): Promise<Response> {
  const bytes = await readPdfBytes(req);
  if (!bytes) {
    return jsonError(400, "A PDF is required", "invalid_request");
  }
  const result = await verifySealedPdf(bytes);
  return Response.json(result);
}
