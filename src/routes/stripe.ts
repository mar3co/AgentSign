import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { getEnv } from "../env.js";
import type { AuditDb } from "../lib/audit.js";
import { getAuth } from "../lib/auth/supabase.js";
import { getStripe } from "../lib/billing.js";
import { getDeps } from "../lib/deps.js";
import { extendKeep } from "../lib/keys.js";

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function requireDb(): AuditDb {
  return getDeps().db ?? getDb();
}

function customerIdOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id: unknown }).id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

/** Session cookie required. 303 to Stripe Checkout (subscription, Pro price). */
export async function postUpgrade(req: Request): Promise<Response> {
  const cookie = req.headers.get("cookie");
  if (!cookie) return jsonError(401, "Unauthorized", "unauthorized");
  const user = await getAuth().userFromCookie(cookie);
  if (!user) return jsonError(401, "Unauthorized", "unauthorized");

  const origin = new URL(req.url).origin;
  const session = await getStripe().createCheckout({
    mode: "subscription",
    line_items: [{ price: getEnv().STRIPE_PRICE_PRO, quantity: 1 }],
    client_reference_id: user.id,
    success_url: `${origin}/upgrade?success=1`,
    cancel_url: `${origin}/upgrade?canceled=1`,
  });
  if (!session.url) return jsonError(500, "Checkout failed", "checkout_failed");
  return new Response(null, {
    status: 303,
    headers: { location: session.url },
  });
}

/** Raw body + Stripe-Signature. Pro keep on checkout.session.completed. */
export async function postStripeWebhook(req: Request): Promise<Response> {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return jsonError(400, "Missing signature", "invalid_signature");
  const payload = await req.text();
  let event;
  try {
    event = getStripe().constructEvent(
      payload,
      signature,
      getEnv().STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return jsonError(400, "Invalid signature", "invalid_signature");
  }

  const db = requireDb();
  const obj = event.data.object;

  if (event.type === "checkout.session.completed") {
    const userId =
      typeof obj.client_reference_id === "string" ? obj.client_reference_id : "";
    if (userId) {
      const stripeCustomerId = customerIdOf(obj.customer);
      await db
        .insert(accounts)
        .values({
          userId,
          plan: "pro",
          stripeCustomerId: stripeCustomerId ?? undefined,
        })
        .onConflictDoUpdate({
          target: accounts.userId,
          set: {
            plan: "pro",
            ...(stripeCustomerId ? { stripeCustomerId } : {}),
          },
        });
      await extendKeep(db, userId);
    }
    return Response.json({ ok: true });
  }

  if (event.type === "customer.subscription.deleted") {
    const stripeCustomerId = customerIdOf(obj.customer);
    if (stripeCustomerId) {
      await db
        .update(accounts)
        .set({ plan: "free" })
        .where(eq(accounts.stripeCustomerId, stripeCustomerId));
    }
    return Response.json({ ok: true });
  }

  return Response.json({ ok: true });
}
