import { getSending, patchSending } from "../../../src/routes/sending.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return getSending(req);
}

export async function PATCH(req: Request): Promise<Response> {
  return patchSending(req);
}
