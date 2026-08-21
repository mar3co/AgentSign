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
});
