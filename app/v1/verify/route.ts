import { verifyEnvelope } from "../../../src/routes/verify.js";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return verifyEnvelope(req);
}
