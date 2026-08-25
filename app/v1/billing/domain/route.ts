import { putBillingDomain } from "../../../../src/routes/billing.js";

export const runtime = "nodejs";

export async function PUT(req: Request): Promise<Response> {
  return putBillingDomain(req);
}
