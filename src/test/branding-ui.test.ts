// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BrandingClient } from "../../app/settings/branding/branding-client.js";
import { BrandingForm } from "../../app/settings/branding/branding-form.js";
import { AppShell } from "../../components/app-shell.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "",
}));

describe("BrandingForm", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows upgrade link and no file input when not entitled", () => {
    render(createElement(BrandingForm, { entitled: false }));
    expect(screen.getByRole("link", { name: /upgrade/i }).getAttribute("href")).toBe(
      "/upgrade",
    );
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("shows display name and logo inputs when entitled owner", () => {
    render(
      createElement(BrandingForm, {
        entitled: true,
        displayName: "Shop Co",
        hasLogo: false,
        canEdit: true,
      }),
    );
    expect(screen.getByDisplayValue("Shop Co")).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("shows name and no file input when member cannot edit", () => {
    render(
      createElement(BrandingForm, {
        entitled: true,
        displayName: "Shop Co",
        hasLogo: false,
        canEdit: false,
      }),
    );
    expect(screen.getByText("Shop Co")).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});

describe("sidebar Branding link", () => {
  afterEach(() => {
    cleanup();
  });

  it("links Branding to /settings/branding", () => {
    render(createElement(AppShell, null, "content"));
    expect(
      screen.getAllByRole("link", { name: /^branding$/i })[0]?.getAttribute("href"),
    ).toBe("/settings/branding");
  });
});

describe("BrandingClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders member read-only when GET can_edit is false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            display_name: "Shop Co",
            has_logo: false,
            can_edit: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    render(createElement(BrandingClient));
    expect(await screen.findByText("Shop Co")).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
