// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppShell } from "../../components/app-shell.js";
import { ByteRange } from "../../components/byte-range.js";
import { SiteFooter } from "../../components/site-footer.js";
import { SiteHeader } from "../../components/site-header.js";
import { DocumentsList } from "../../app/documents/documents-list.js";
import PrivacyPage from "../../app/privacy/page.js";
import TermsPage from "../../app/terms/page.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "/documents",
}));

describe("SiteHeader", () => {
  afterEach(() => {
    cleanup();
  });

  it("public header links the wordmark home and Log in, not app nav items", () => {
    render(createElement(SiteHeader, { variant: "public" }));
    expect(screen.getByRole("link", { name: /^openseal$/i }).getAttribute("href")).toBe(
      "/",
    );
    expect(screen.getByRole("link", { name: /log in/i }).getAttribute("href")).toBe(
      "/login",
    );
    expect(screen.getByRole("link", { name: /^pricing$/i }).getAttribute("href")).toBe(
      "/upgrade",
    );
    expect(screen.queryByRole("link", { name: /^templates$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^branding$/i })).toBeNull();
  });

});

describe("AppShell", () => {
  afterEach(() => {
    cleanup();
  });

  it("sidebar is the only app nav and marks the active page", () => {
    render(createElement(AppShell, null, "content"));
    const href = (name: RegExp) =>
      screen.getAllByRole("link", { name })[0]?.getAttribute("href");
    expect(href(/^send$/i)).toBe("/send");
    expect(href(/^documents$/i)).toBe("/documents");
    expect(href(/^templates$/i)).toBe("/templates");
    expect(href(/^settings$/i)).toBe("/settings");
    expect(screen.queryByRole("link", { name: /^branding$/i })).toBeNull();
    expect(href(/^team$/i)).toBe("/team");
    expect(href(/^agents$/i)).toBe("/agents");
    expect(href(/^docs$/i)).toBe("/docs");
    // The header title reflects the mocked /documents pathname.
    expect(screen.getByRole("heading", { name: /^documents$/i })).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: /^documents$/i })[0]
        ?.hasAttribute("data-active"),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: /^templates$/i })[0]
        ?.hasAttribute("data-active"),
    ).toBe(false);
  });

  it("sidebar mark sits on a wax tile with a one-color glyph", () => {
    render(createElement(AppShell, null, "content"));
    const lockup = screen.getByRole("link", { name: /^openseal$/i });
    const mark = lockup.querySelector("svg");
    expect(mark?.parentElement?.className).toContain("bg-brand-wax");
    expect(mark?.querySelector("rect[fill='var(--brand-wax)']")).toBeNull();
  });

  it("has no color band; Send a document is the wax CTA on a quiet canvas", () => {
    const { container } = render(createElement(AppShell, null, "content"));
    expect(container.querySelector(".app-band")).toBeNull();
    expect(container.querySelector("header")?.className).not.toContain(
      "text-primary-foreground",
    );
    expect(
      screen.getByRole("link", { name: /send a document/i }).className,
    ).toContain("bg-brand-wax");
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
          new Response(JSON.stringify({ email: "demo@openseal.me" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(createElement(AppShell, null, "content"));
    expect(await screen.findByText("demo@openseal.me")).toBeTruthy();
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

describe("DocumentsList table", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders documents in a table and no duplicate app nav", () => {
    render(
      createElement(DocumentsList, {
        documents: [
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
    expect(screen.getByRole("columnheader", { name: /document/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /status/i })).toBeTruthy();
    expect(screen.getByText("Repair authorization")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^templates$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^branding$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^team$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /^agents$/i })).toBeNull();
  });
});
