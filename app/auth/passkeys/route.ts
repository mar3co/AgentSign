import { getPasskeys, postPasskeyRegister } from "../../../src/routes/auth.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return getPasskeys(req);
}

export async function POST(req: Request): Promise<Response> {
  return postPasskeyRegister(req);
}
