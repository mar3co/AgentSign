import { getStats } from "../../../src/routes/stats.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return getStats(req);
}
