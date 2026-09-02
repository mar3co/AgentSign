import { getOauthGrants } from "../../../../src/routes/oauth.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return getOauthGrants(req);
}
