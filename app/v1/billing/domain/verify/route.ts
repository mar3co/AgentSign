import { verifyBillingDomain } from "../../../../../src/routes/billing.js";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return verifyBillingDomain(req);
}
