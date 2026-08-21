import { getTeam } from "../../../src/routes/team.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return getTeam(req);
}
