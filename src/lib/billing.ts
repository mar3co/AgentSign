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

function cardOnFile(raw: unknown): CardOnFile | null {
  if (!raw || typeof raw !== "object") return null;
  const nested = "card" in raw ? (raw as { card?: { brand?: string; last4?: string } | null }).card : null;
  const brand = nested?.brand ?? (raw as { brand?: string }).brand;
  const last4 = nested?.last4 ?? (raw as { last4?: string }).last4;
  if (!brand || !last4) return null;
  return { brand, last4 };
}

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
      const customer = await client.customers.retrieve(customerId, {
        expand: ["invoice_settings.default_payment_method", "default_source"],
      });
      if (customer.deleted) return null;
      const fromInvoice = cardOnFile(customer.invoice_settings.default_payment_method);
      if (fromInvoice) return fromInvoice;
      const fromSource = cardOnFile(customer.default_source);
      if (fromSource) return fromSource;
      const methods = await client.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 1,
      });
      return cardOnFile(methods.data[0]);
    },
  };
}
