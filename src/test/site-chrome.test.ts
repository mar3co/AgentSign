// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppShell } from "../../components/app-shell.js";
import { ByteRange } from "../../components/byte-range.js";
import { SiteFooter } from "../../components/site-footer.js";
import { SiteHeader } from "../../components/site-header.js";
import { CabinetList } from "../../app/envelopes/cabinet-list.js";
import PrivacyPage from "../../app/privacy/page.js";
import TermsPage from "../../app/terms/page.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "/envelopes",
}));

describe("SiteHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("public header links the wordmark home and Log in, not cabinet items", () => {
    render(createElement(SiteHeader, { variant: "public" }));
    expect(screen.getByRole("link", { name: /^agentsign$/i }).getAttribute("href")).toBe(
      "/",
    );
    expect(screen.getByRole("link", { name: /log in/i }).getAttribute("href")).toBe(
      "/login",
    );
    expect(screen.getByRole("link", { name: /^pricing$/i }).getAttribute("href")).toBe(
      "/upgrade",
    );
    expect(screen.queryByRole("link", { name: /^packets$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^branding$/i })).toBeNull();
  });

});

describe("AppShell", () => {
  afterEach(() => {
    cleanup();
  });

  it("sidebar is the only cabinet nav and marks the active page", () => {
    render(createElement(AppShell, null, "content"));
    const href = (name: RegExp) =>
      screen.getAllByRole("link", { name })[0]?.getAttribute("href");
    expect(href(/^send$/i)).toBe("/send");
    expect(href(/^cabinet$/i)).toBe("/envelopes");
    expect(href(/^packets$/i)).toBe("/packets");
    expect(href(/^branding$/i)).toBe("/settings/branding");
    expect(href(/^team$/i)).toBe("/team");
    expect(href(/^agents$/i)).toBe("/agents");
    expect(href(/^docs$/i)).toBe("/docs");
    // The header title reflects the mocked /envelopes pathname.
    expect(screen.getByRole("heading", { name: /^cabinet$/i })).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: /^cabinet$/i })[0]
        ?.hasAttribute("data-active"),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: /^packets$/i })[0]
        ?.hasAttribute("data-active"),
    ).toBe(false);
  });
});

describe("NavUser", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the signed-in email from whoami", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ email: "demo@agentsign.dev" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(createElement(AppShell, null, "content"));
    expect(await screen.findByText("demo@agentsign.dev")).toBeTruthy();
  });

  it("offers Log in when whoami says there is no session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );
    render(createElement(AppShell, null, "content"));
    const link = await screen.findByRole("link", { name: /log in/i });
    expect(link.getAttribute("href")).toBe("/login");
  });
});

describe("SiteFooter", () => {
  afterEach(() => {
    cleanup();
  });

  it("links privacy, terms, pricing, OpenAPI, and llms.txt", () => {
    render(createElement(SiteFooter));
    expect(screen.getByRole("link", { name: /privacy/i }).getAttribute("href")).toBe(
      "/privacy",
    );
    expect(screen.getByRole("link", { name: /terms/i }).getAttribute("href")).toBe(
      "/terms",
    );
    expect(screen.getByRole("link", { name: /^pricing$/i }).getAttribute("href")).toBe(
      "/upgrade",
    );
    expect(screen.getByRole("link", { name: /openapi/i }).getAttribute("href")).toBe(
      "/openapi.json",
    );
    expect(screen.getByRole("link", { name: /llms\.txt/i }).getAttribute("href")).toBe(
      "/llms.txt",
    );
  });
});

describe("ByteRange", () => {
  afterEach(() => {
    cleanup();
  });

  it("exposes unsigned and sealed names", () => {
    const { rerender } = render(createElement(ByteRange));
    expect(screen.getByRole("img", { name: /unsigned byterange/i })).toBeTruthy();
    rerender(createElement(ByteRange, { sealed: true }));
    expect(screen.getByRole("img", { name: /sealed byterange/i })).toBeTruthy();
  });
});

describe("legal pages", () => {
  afterEach(() => {
    cleanup();
  });

  it("privacy says what we keep and shred", () => {
    render(createElement(PrivacyPage));
    expect(screen.getByRole("heading", { name: /privacy/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /what we keep/i })).toBeTruthy();
    expect(document.body.textContent).toMatch(/shred/i);
    expect(document.body.textContent).not.toMatch(/statutory POA/i);
  });

  it("terms name the Apache-2.0 license and $19 Pro", () => {
    render(createElement(TermsPage));
    expect(screen.getByRole("heading", { name: /terms/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /finish and attest/i })).toBeTruthy();
    expect(document.body.textContent).toMatch(/Apache-2\.0/);
    expect(document.body.textContent).toMatch(/\$19/);
  });
});

describe("CabinetList table", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders envelopes in a table and no duplicate app nav", () => {
    render(
      createElement(CabinetList, {
        envelopes: [
          {
            id: "env_1",
            title: "Repair authorization",
            status: "completed",
            canDelete: true,
          },
        ],
      }),
    );
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /title/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /status/i })).toBeTruthy();
    expect(screen.getByText("Repair authorization")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^packets$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^branding$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^team$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^agents$/i })).toBeNull();
  });
});
