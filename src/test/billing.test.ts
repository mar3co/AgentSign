import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import UpgradePage from "../../app/upgrade/page.js";
import { POST as postUpgrade } from "../../app/upgrade/checkout/route.js";
import { POST as postStripe } from "../../app/internal/stripe/route.js";
import { GET as getBilling } from "../../app/v1/billing/route.js";
import { POST as postPortal } from "../../app/v1/billing/portal/route.js";
import { PUT as putDomain } from "../../app/v1/billing/domain/route.js";
import { POST as postVerifyDomain } from "../../app/v1/billing/domain/verify/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { accounts, documents, signers as signersTable } from "../db/schema.js";
import { setDeps } from "../lib/deps.js";
import { resetEnvCache } from "../env.js";
import { createTestDb } from "./db.js";

type AuthUser = { id: string; email: string };

type CheckoutParams = {
  mode: string;
  line_items: { price: string; quantity: number }[];
  client_reference_id: string;
  success_url: string;
  cancel_url: string;
};

function createFakeAuth() {
  const users = new Map<string, AuthUser>();
  const sessions = new Map<string, AuthUser>();
  const codes = new Map<string, AuthUser>();

  function userFor(email: string): AuthUser {
    const e = email.toLowerCase();
    let u = users.get(e);
    if (!u) {
      u = { id: randomUUID(), email: e };
      users.set(e, u);
    }
    return u;
  }

  return {
    userFor,
    adapter: {
      async sendMagicLink({ email }: { email: string }) {
        const u = userFor(email);
        codes.set(`magic:${u.email}`, u);
      },
      async signInWithPassword() {
        return {
          ok: false as const,
          error: "Invalid credentials",
          code: "invalid_credentials",
        };
      },
      async signUp() {
        return { ok: true as const };
      },
      async startOAuth({ redirectTo }: { redirectTo: string }) {
        return { url: redirectTo };
      },
      async userFromCookie(header: string | null) {
        if (!header) return null;
        const m = header.match(/(?:^|;\s*)sign_session=([^;]+)/);
        if (!m) return null;
        return sessions.get(m[1]!) ?? null;
      },
      async exchangeCode(code: string) {
        const u = codes.get(code);
        if (!u) return null;
        const token = randomUUID();
        sessions.set(token, u);
        return {
          user: u,
          cookie: `sign_session=${token}; Path=/; HttpOnly`,
        };
      },
    },
  };
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

async function magicCookie(email: string) {
  const login = await postLogin(
    new Request("http://sign.test/login/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  expect(login.status).toBe(200);
  const cb = await getAuthCallback(
    new Request(
      `http://sign.test/auth/callback?code=${encodeURIComponent(`magic:${email.toLowerCase()}`)}`,
    ),
  );
  expect(cb.status).toBe(302);
  return cookieFrom(cb);
}

const PRICE = "price_pro_test";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_123";

function withStripeEnv(run: () => Promise<void>) {
  const prevPrice = process.env.STRIPE_PRICE_PRO;
  const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_PRO = PRICE;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  resetEnvCache();
  return run().finally(() => {
    if (prevPrice === undefined) delete process.env.STRIPE_PRICE_PRO;
    else process.env.STRIPE_PRICE_PRO = prevPrice;
    if (prevSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
    resetEnvCache();
  });
}

describe("Stripe Checkout Pro", () => {
  it("upgrade page Keep this a year posts to /upgrade/checkout", () => {
    const html = renderToStaticMarkup(createElement(UpgradePage));
    expect(html).toMatch(/Keep this a year/i);
    expect(html).toContain('action="/upgrade/checkout"');
  });

  it("unauthenticated POST /upgrade/checkout is 401", async () => {
    await withStripeEnv(async () => {
      const db = await createTestDb();
      setDeps({
        db,
        stripe: {
          createCheckout: async () => ({ url: CHECKOUT_URL }),
          constructEvent: () => ({ type: "unknown", data: { object: {} } }),
        },
      });
      const res = await postUpgrade(
        new Request("http://sign.test/upgrade/checkout", { method: "POST" }),
      );
      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: string; code: string };
      expect(json.error).toBeTruthy();
      expect(json.code).toBeTruthy();
    });
  });

  it("session POST /upgrade/checkout redirects 303 to Checkout URL", async () => {
    await withStripeEnv(async () => {
      const db = await createTestDb();
      const fake = createFakeAuth();
      let created: CheckoutParams | undefined;
      setDeps({
        db,
        auth: fake.adapter,
        stripe: {
          createCheckout: async (params: CheckoutParams) => {
            created = params;
            return { url: CHECKOUT_URL };
          },
          constructEvent: () => ({ type: "unknown", data: { object: {} } }),
        },
      });
      const cookie = await magicCookie("shop@example.com");
      const user = fake.userFor("shop@example.com");
      const res = await postUpgrade(
        new Request("http://sign.test/upgrade/checkout", {
          method: "POST",
          headers: { cookie },
        }),
      );
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(CHECKOUT_URL);
      expect(created).toMatchObject({
        mode: "subscription",
        line_items: [{ price: PRICE, quantity: 1 }],
        client_reference_id: user.id,
      });
      expect(created!.success_url).toMatch(/^http:\/\/sign\.test\//);
      expect(created!.cancel_url).toMatch(/^http:\/\/sign\.test\//);
    });
  });

  it("checkout.session.completed sets pro and extendKeep ~ +365d", async () => {
    await withStripeEnv(async () => {
      const db = await createTestDb();
      const userId = randomUUID();
      const signedAt = new Date("2026-01-01T00:00:00Z");
      const now = new Date("2026-01-02T00:00:00Z");
      const event = {
        type: "checkout.session.completed",
        data: {
          object: {
            client_reference_id: userId,
            customer: "cus_test_123",
          },
        },
      };
      setDeps({
        db,
        now: () => now,
        stripe: {
          createCheckout: async () => ({ url: CHECKOUT_URL }),
          constructEvent: (payload: string, signature: string) => {
            expect(signature).toBe("sig_test");
            expect(payload).toContain("checkout.session.completed");
            return event;
          },
        },
      });
      await db.insert(accounts).values({
        userId,
        email: "shop@example.com",
        plan: "free",
      });
      const [envRow] = await db
        .insert(documents)
        .values({
          title: "Sent",
          senderEmail: "shop@example.com",
          status: "completed",
          userId,
          expiresAt: signedAt,
          shredAt: new Date(signedAt.getTime() + 7 * 86_400_000),
        })
        .returning();
      await db.insert(signersTable).values({
        documentId: envRow!.id,
        name: "Jane",
        email: "jane@example.com",
        signingOrder: 1,
        tokenHash: "hash-sent",
        signedAt,
      });

      const res = await postStripe(
        new Request("http://sign.test/internal/stripe", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "stripe-signature": "sig_test",
          },
          body: JSON.stringify(event),
        }),
      );
      expect(res.status).toBe(200);

      const [account] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, userId));
      expect(account!.plan).toBe("pro");
      expect(account!.stripeCustomerId).toBe("cus_test_123");

      const [after] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, envRow!.id));
      expect(after!.shredAt.getTime()).toBe(signedAt.getTime() + 365 * 86_400_000);
    });
  });

  it("unsigned webhook is 400", async () => {
    await withStripeEnv(async () => {
      const db = await createTestDb();
      setDeps({
        db,
        stripe: {
          createCheckout: async () => ({ url: CHECKOUT_URL }),
          constructEvent: () => {
            throw new Error("should not construct without signature");
          },
        },
      });
      const res = await postStripe(
        new Request("http://sign.test/internal/stripe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "checkout.session.completed" }),
        }),
      );
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; code: string };
      expect(json.error).toBeTruthy();
      expect(json.code).toBeTruthy();
    });
  });

  it("customer.subscription.deleted sets free and does not shred", async () => {
    await withStripeEnv(async () => {
      const db = await createTestDb();
      const userId = randomUUID();
      const shredAt = new Date("2027-01-01T00:00:00Z");
      const event = {
        type: "customer.subscription.deleted",
        data: { object: { customer: "cus_keep" } },
      };
      setDeps({
        db,
        stripe: {
          createCheckout: async () => ({ url: CHECKOUT_URL }),
          constructEvent: () => event,
        },
      });
      await db.insert(accounts).values({
        userId,
        email: "shop@example.com",
        plan: "pro",
        stripeCustomerId: "cus_keep",
      });
      const [envRow] = await db
        .insert(documents)
        .values({
          title: "Kept",
          senderEmail: "shop@example.com",
          status: "completed",
          userId,
          expiresAt: new Date("2026-01-01T00:00:00Z"),
          shredAt,
        })
        .returning();

      const res = await postStripe(
        new Request("http://sign.test/internal/stripe", {
          method: "POST",
          headers: {
            "stripe-signature": "sig_test",
            "content-type": "application/json",
          },
          body: JSON.stringify(event),
        }),
      );
      expect(res.status).toBe(200);
      const [account] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.userId, userId));
      expect(account!.plan).toBe("free");
      const [after] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, envRow!.id));
      expect(after!.shredAt.getTime()).toBe(shredAt.getTime());
    });
  });

  it("unknown webhook events return 200", async () => {
    await withStripeEnv(async () => {
      const db = await createTestDb();
      setDeps({
        db,
        stripe: {
          createCheckout: async () => ({ url: CHECKOUT_URL }),
          constructEvent: () => ({
            type: "invoice.paid",
            data: { object: {} },
          }),
        },
      });
      const res = await postStripe(
        new Request("http://sign.test/internal/stripe", {
          method: "POST",
          headers: { "stripe-signature": "sig_test" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(200);
    });
  });
});

const PORTAL_URL = "https://billing.stripe.com/p/session/test";

describe("billing usage, portal, and domain", () => {
  it("GET /v1/billing reports send usage against the free cap", async () => {
    await withStripeEnv(async () => {
      const db = await createTestDb();
      const fake = createFakeAuth();
      const now = new Date("2026-08-15T00:00:00Z");
      setDeps({
        db,
        auth: fake.adapter,
        now: () => now,
        stripe: {
          createCheckout: async () => ({ url: CHECKOUT_URL }),
          constructEvent: () => ({ type: "unknown", data: { object: {} } }),
        },
      });
      const cookie = await magicCookie("shop@example.com");
      const userId = fake.userFor("shop@example.com").id;
      await db.insert(documents).values({
        title: "One",
        senderEmail: "shop@example.com",
        userId,
        status: "pending",
        expiresAt: now,
        shredAt: now,
        createdAt: now,
      });
      const res = await getBilling(
        new Request("http://sign.test/v1/billing", { headers: { cookie } }),
      );
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        plan: string;
        entitled: boolean;
        usage: {
          sends: { used: number; limit: number | null; window_days: number };
          seats: { used: number; limit: number };
        };
        payment_method: unknown;
        domain: { hostname: string | null; verified: boolean; cname_target: string };
      };
      expect(json.plan).toBe("free");
      expect(json.entitled).toBe(false);
      expect(json.usage.sends.used).toBe(1);
      expect(json.usage.sends.limit).toBe(20);
      expect(json.usage.sends.window_days).toBe(30);
      await db.insert(documents).values({
        title: "Voided",
        senderEmail: "shop@example.com",
        userId,
        status: "deleted",
        expiresAt: now,
        shredAt: now,
        createdAt: now,
      });
      await db.insert(documents).values({
        title: "Walk-in",
        senderEmail: "shop@example.com",
        userId: null,
        status: "pending",
        expiresAt: now,
        shredAt: now,
        createdAt: now,
      });
      const again = await getBilling(
        new Request("http://sign.test/v1/billing", { headers: { cookie } }),
      );
      expect(again.status).toBe(200);
      const counted = (await again.json()) as {
        usage: { sends: { used: number } };
      };
      expect(counted.usage.sends.used).toBe(3);
      expect(json.usage.seats.used).toBe(1);
      expect(json.payment_method).toBeNull();
      expect(json.domain.hostname).toBeNull();
      expect(json.domain.verified).toBe(false);
      expect(json.domain.cname_target).toBeTruthy();
    });
  });

  it("Pro portal redirects to Stripe Billing Portal", async () => {
    await withStripeEnv(async () => {
      const db = await createTestDb();
      const fake = createFakeAuth();
      let portalCustomer: string | undefined;
      setDeps({
        db,
        auth: fake.adapter,
        stripe: {
          createCheckout: async () => ({ url: CHECKOUT_URL }),
          constructEvent: () => ({ type: "unknown", data: { object: {} } }),
          createBillingPortal: async (params: { customer: string }) => {
            portalCustomer = params.customer;
            return { url: PORTAL_URL };
          },
          getDefaultPaymentMethod: async () => ({ brand: "visa", last4: "4242" }),
        },
      });
      const cookie = await magicCookie("shop@example.com");
      const userId = fake.userFor("shop@example.com").id;
      await db
        .update(accounts)
        .set({ plan: "pro", stripeCustomerId: "cus_test_123" })
        .where(eq(accounts.userId, userId));
      const res = await postPortal(
        new Request("http://sign.test/v1/billing/portal", {
          method: "POST",
          headers: { cookie },
        }),
      );
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(PORTAL_URL);
      expect(portalCustomer).toBe("cus_test_123");
    });
  });

  it("free owner cannot open the portal or set a domain", async () => {
    await withStripeEnv(async () => {
      const db = await createTestDb();
      const fake = createFakeAuth();
      setDeps({
        db,
        auth: fake.adapter,
        stripe: {
          createCheckout: async () => ({ url: CHECKOUT_URL }),
          constructEvent: () => ({ type: "unknown", data: { object: {} } }),
        },
      });
      const cookie = await magicCookie("shop@example.com");
      const portal = await postPortal(
        new Request("http://sign.test/v1/billing/portal", {
          method: "POST",
          headers: { cookie },
        }),
      );
      expect(portal.status).toBe(403);
      const domain = await putDomain(
        new Request("http://sign.test/v1/billing/domain", {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ hostname: "sign.acme.com" }),
        }),
      );
      expect(domain.status).toBe(403);
    });
  });

  it("Pro owner saves a pending domain and verifies on matching CNAME", async () => {
    await withStripeEnv(async () => {
      const db = await createTestDb();
      const fake = createFakeAuth();
      const prevApp = process.env.APP_URL;
      process.env.APP_URL = "https://agentsign.co";
      resetEnvCache();
      setDeps({
        db,
        auth: fake.adapter,
        stripe: {
          createCheckout: async () => ({ url: CHECKOUT_URL }),
          constructEvent: () => ({ type: "unknown", data: { object: {} } }),
        },
        resolveCname: async () => ["agentsign.co"],
      });
      try {
        const cookie = await magicCookie("shop@example.com");
        const userId = fake.userFor("shop@example.com").id;
        await db
          .update(accounts)
          .set({ plan: "pro" })
          .where(eq(accounts.userId, userId));
        const put = await putDomain(
          new Request("http://sign.test/v1/billing/domain", {
            method: "PUT",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({ hostname: "sign.acme.com" }),
          }),
        );
        expect(put.status).toBe(200);
        const pending = (await put.json()) as {
          hostname: string;
          verified: boolean;
          cname_target: string;
        };
        expect(pending.hostname).toBe("sign.acme.com");
        expect(pending.verified).toBe(false);
        expect(pending.cname_target).toBe("agentsign.co");
        const verify = await postVerifyDomain(
          new Request("http://sign.test/v1/billing/domain/verify", {
            method: "POST",
            headers: { cookie },
          }),
        );
        expect(verify.status).toBe(200);
        const done = (await verify.json()) as { verified: boolean };
        expect(done.verified).toBe(true);
        const [row] = await db
          .select()
          .from(accounts)
          .where(eq(accounts.userId, userId));
        expect(row?.customDomain).toBe("sign.acme.com");
        expect(row?.customDomainVerifiedAt).toBeTruthy();
      } finally {
        if (prevApp === undefined) delete process.env.APP_URL;
        else process.env.APP_URL = prevApp;
        resetEnvCache();
      }
    });
  });
});
