import { createEnvelope } from "../../../src/routes/envelopes.js";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  _ctx?: { params: Promise<{ id: string }> },
): Promise<Response> {
  return createEnvelope(req);
}
