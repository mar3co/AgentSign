import { postSignup } from "../../src/routes/auth.js";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return postSignup(req);
}
