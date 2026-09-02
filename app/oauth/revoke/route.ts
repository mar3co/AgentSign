import { postRevoke } from "../../../src/routes/oauth.js";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return postRevoke(req);
}
