import { getWhoami } from "../../../src/routes/auth.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return getWhoami(req);
}
