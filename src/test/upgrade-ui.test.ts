// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import UpgradePage from "../../app/upgrade/page.js";

describe("UpgradePage", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows Free and Pro at $19/mo, not a three-SKU grid", () => {
    render(createElement(UpgradePage));
    expect(screen.getByText(/^Free$/)).toBeTruthy();
    expect(screen.getByText(/^Pro$/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/\$19/);
    expect(screen.getByRole("button", { name: /keep this a year/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Enterprise/);
    expect(document.body.textContent).not.toMatch(/Personal/);
    const form = screen.getByRole("button", { name: /keep this a year/i }).closest("form");
    expect(form?.getAttribute("action")).toBe("/upgrade/checkout");
    expect(form?.getAttribute("method")?.toLowerCase()).toBe("post");
  });

  it("shows the pricing JSON twin", () => {
    render(createElement(UpgradePage));
    // TwoReader mounts the machine node twice (mobile disclosure + desktop column).
    expect(screen.getAllByText("Pricing as data").length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('"price_usd_month": 19');
  });

  it("carries the locked human copy and one seal-red CTA", () => {
    render(createElement(UpgradePage));
    expect(screen.getByText("One flat price")).toBeTruthy();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Keep the file a year.");
    expect(heading.querySelector(".text-seal")?.textContent).toBe(".");
    const cta = screen.getByRole("button", { name: /keep this a year/i });
    expect(cta.className).toContain("bg-seal");
    expect(document.body.textContent).toContain(
      "No seats. No per-document fees. Cancel any time.",
    );
    // No address on the pricing panel: /llms.txt does not serve this JSON,
    // and machine-side addresses must be real. Scoped to the panel because the
    // shared footer and header legitimately link to /llms.txt.
    for (const eyebrow of screen.getAllByText("Pricing as data")) {
      const header = eyebrow.parentElement;
      expect(header?.children.length).toBe(1);
      expect(header?.textContent).toBe("Pricing as data");
    }
  });
});
