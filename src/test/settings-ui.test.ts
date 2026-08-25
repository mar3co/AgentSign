// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountClient } from "../../app/settings/account-client.js";
import { BillingClient } from "../../app/settings/billing/billing-client.js";
import {
  SettingsSection,
  SettingsShell,
} from "../../components/settings-shell.js";

describe("SettingsShell", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes Account, Workspace, Security, Branding, and Billing as URL tabs", () => {
    render(createElement(SettingsShell, { current: "account" }, "body"));
    const href = (name: RegExp) =>
      screen.getByRole("link", { name }).getAttribute("href");
    expect(href(/^account$/i)).toBe("/settings");
    expect(href(/^workspace$/i)).toBe("/settings/workspace");
    expect(href(/^security$/i)).toBe("/settings/security");
    expect(href(/^branding$/i)).toBe("/settings/branding");
    expect(href(/^billing$/i)).toBe("/settings/billing");
    expect(screen.getByRole("link", { name: /^account$/i }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: /^workspace$/i }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: /^billing$/i }).getAttribute("aria-current")).toBeNull();
  });

  it("sizes tabs like sidebar nav, not like the page title", () => {
    render(createElement(SettingsShell, { current: "account" }, "body"));
    const tab = screen.getByRole("link", { name: /^account$/i }).className;
    expect(tab).toContain("text-sm");
    expect(tab).not.toContain("text-base");
  });
});

describe("SettingsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("sizes section titles like dashboard labels, not like the page title", () => {
    render(
      createElement(
        SettingsSection,
        { title: "Email", description: "Your login identity." },
        "body",
      ),
    );
    const heading = screen.getByRole("heading", { name: /^email$/i }).className;
    expect(heading).toContain("text-sm");
    expect(heading).toContain("font-semibold");
  });
});

describe("AccountClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the signed-in email from whoami", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ email: "dev@localhost" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(createElement(AccountClient));
    expect(await screen.findByDisplayValue("dev@localhost")).toBeTruthy();
    expect(screen.getByLabelText(/^email$/i)).toHaveProperty("disabled", true);
  });
});

const FREE_BILLING = {
  plan: "free",
  entitled: false,
  role: "owner",
  current_period_end: null,
  usage: {
    sends: { used: 3, limit: 20, window_days: 30 },
    seats: { used: 1, limit: 10 },
    templates: { used: 0, limit: 50 },
    agents: { used: 0, limit: 10 },
  },
  payment_method: null,
};

const PRO_BILLING = {
  plan: "pro",
  entitled: true,
  role: "owner",
  current_period_end: "2026-09-24T00:00:00.000Z",
  usage: {
    sends: { used: 12, limit: null, window_days: 30 },
    seats: { used: 2, limit: 10 },
    templates: { used: 1, limit: 50 },
    agents: { used: 1, limit: 10 },
  },
  payment_method: { brand: "visa", last4: "4242" },
};

function stubBilling(body: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("BillingClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends the free plan to checkout without calling it a cabinet", async () => {
    stubBilling(FREE_BILLING);
    render(createElement(BillingClient));
    expect(await screen.findByText(/you.?re on the free plan/i)).toBeTruthy();
    expect(screen.queryByText(/cabinet/i)).toBeNull();
    const form = screen.getByRole("button", { name: /^upgrade$/i }).closest("form");
    expect(form?.getAttribute("action")).toBe("/upgrade/checkout");
    expect(form?.getAttribute("method")?.toLowerCase()).toBe("post");
  });

  it("shows send usage against the free cap", async () => {
    stubBilling(FREE_BILLING);
    render(createElement(BillingClient));
    expect(await screen.findByText(/3 \/ 20/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^usage$/i })).toBeTruthy();
  });

  it("does not collect card numbers in the app", async () => {
    stubBilling(FREE_BILLING);
    render(createElement(BillingClient));
    await screen.findByText(/you.?re on the free plan/i);
    expect(screen.queryByLabelText(/card number/i)).toBeNull();
    expect(screen.queryByLabelText(/^cvc$/i)).toBeNull();
  });

  it("tells Pro they already keep files a year and shows the card on file", async () => {
    stubBilling(PRO_BILLING);
    render(createElement(BillingClient));
    expect(await screen.findByText(/you.?re on pro/i)).toBeTruthy();
    expect(screen.queryByText(/cabinet/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^upgrade$/i })).toBeNull();
    expect(screen.getByText(/4242/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /manage billing/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^custom domain$/i })).toBeNull();
    expect(screen.queryByLabelText(/^hostname$/i)).toBeNull();
    expect(screen.queryByDisplayValue("sign.acme.com")).toBeNull();
  });
});

