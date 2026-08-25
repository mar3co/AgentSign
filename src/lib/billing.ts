import Stripe from "stripe";
import { getEnv } from "../env.js";
import { getDeps } from "./deps.js";

export type CheckoutCreateParams = {
  mode: "subscription";
  line_items: { price: string; quantity: number }[];
  client_reference_id: string;
  success_url: string;
  cancel_url: string;
};

export type StripeEvent = {
  type: string;
  data: { object: Record<string, unknown> };
};

export type BillingPortalParams = {
  customer: string;
  return_url: string;
};

export type CardOnFile = { brand: string; last4: string };

export type StripeAdapter = {
  createCheckout(params: CheckoutCreateParams): Promise<{ url: string }>;
  constructEvent(payload: string, header: string, secret: string): StripeEvent;
  createBillingPortal?(params: BillingPortalParams): Promise<{ url: string }>;
  getDefaultPaymentMethod?(customerId: string): Promise<CardOnFile | null>;
};

let live: StripeAdapter | undefined;

/** Injected fake in tests (`createCheckout`, `constructEvent`); live Stripe otherwise. */
export function getStripe(): StripeAdapter {
  const injected = getDeps().stripe as StripeAdapter | undefined;
  if (injected) return injected;
  if (!live) live = createLiveStripe();
  return live;
}

function createLiveStripe(): StripeAdapter {
  const key = getEnv().STRIPE_SECRET_KEY || "api_key_placeholder";
  const client = new Stripe(key);
  return {
    async createCheckout(params) {
      const session = await client.checkout.sessions.create(params);
      return { url: session.url ?? "" };
    },
    constructEvent(payload, header, secret) {
      const event = client.webhooks.constructEvent(payload, header, secret);
      return {
        type: event.type,
        data: { object: event.data.object as unknown as Record<string, unknown> },
      };
    },
    async createBillingPortal(params) {
      const session = await client.billingPortal.sessions.create(params);
      return { url: session.url ?? "" };
    },
    async getDefaultPaymentMethod(customerId) {
      const methods = await client.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 1,
      });
      const card = methods.data[0]?.card;
      if (!card?.last4) return null;
      return { brand: card.brand, last4: card.last4 };
    },
  };
}
