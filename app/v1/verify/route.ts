import { verifyDocument } from "../../../src/routes/verify.js";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return verifyDocument(req);
}
