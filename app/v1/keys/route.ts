import { createLiveKey } from "../../../src/routes/keys.js";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return createLiveKey(req);
}
