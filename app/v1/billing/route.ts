import { getBilling } from "../../../src/routes/billing.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return getBilling(req);
}
