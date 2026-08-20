import { createEnvelope, listEnvelopes } from "../../../src/routes/envelopes.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return listEnvelopes(req);
}

export async function POST(req: Request): Promise<Response> {
  return createEnvelope(req);
}
