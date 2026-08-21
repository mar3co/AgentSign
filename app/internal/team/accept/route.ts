import { acceptInvite } from "../../../../src/routes/team.js";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return acceptInvite(req);
}
