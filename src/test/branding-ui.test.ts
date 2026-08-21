// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BrandingForm } from "../../app/settings/branding/branding-form.js";
import { CabinetList } from "../../app/envelopes/cabinet-list.js";

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

describe("cabinet Branding link", () => {
  afterEach(() => {
    cleanup();
  });

  it("links Branding to /settings/branding", () => {
    render(createElement(CabinetList, { envelopes: [] }));
    expect(screen.getByRole("link", { name: /branding/i }).getAttribute("href")).toBe(
      "/settings/branding",
    );
  });
});
