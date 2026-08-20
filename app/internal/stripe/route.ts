import { postStripeWebhook } from "../../../src/routes/stripe.js";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return postStripeWebhook(req);
}
