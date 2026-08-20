import { getLoginOAuth } from "../../../src/routes/auth.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return getLoginOAuth(req, "google");
}
