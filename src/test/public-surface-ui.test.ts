// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageShell } from "../../components/page-shell.js";
import { SiteHeader } from "../../components/site-header.js";
import { SiteFooter } from "../../components/site-footer.js";

describe("PageShell public surface", () => {
  afterEach(() => cleanup());

  it("marks public variant with data-surface", () => {
    const { container } = render(
      createElement(PageShell, { variant: "public", children: "hi" }),
    );
    expect(container.querySelector('[data-surface="public"]')).toBeTruthy();
  });

  it("marks auth variant with data-surface", () => {
    const { container } = render(
      createElement(PageShell, { variant: "auth", children: "hi" }),
    );
    expect(container.querySelector('[data-surface="public"]')).toBeTruthy();
  });

  it("marks the app surface and leaves ceremony unmarked", () => {
    const app = render(
      createElement(PageShell, { variant: "app", children: "hi" }),
    );
    expect(app.container.querySelector('[data-surface="app"]')).toBeTruthy();
    expect(app.container.querySelector('[data-surface="public"]')).toBeNull();
    cleanup();
    const ceremony = render(
      createElement(PageShell, { variant: "ceremony", children: "hi" }),
    );
    expect(ceremony.container.querySelector("[data-surface]")).toBeNull();
    cleanup();
  });
});

describe("public chrome", () => {
  afterEach(() => cleanup());

  it("public header shows Docs, Pricing, llms.txt, and Log in", () => {
    render(createElement(SiteHeader, { variant: "public" }));
    expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe(
      "/docs",
    );
    expect(screen.getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe(
      "/upgrade",
    );
    expect(screen.getByRole("link", { name: "Pricing" }).className).toContain(
      "sm:inline",
    );
    expect(screen.getByRole("link", { name: "/llms.txt" }).getAttribute("href")).toBe(
      "/llms.txt",
    );
    expect(screen.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it("public header lockup is the mark plus a font-heading wordmark", () => {
    render(createElement(SiteHeader, { variant: "public" }));
    const lockup = screen.getByRole("link", { name: "OpenSeal" });
    expect(lockup.querySelector("svg")).toBeTruthy();
    expect(lockup.querySelector(".font-heading")?.textContent).toBe("OpenSeal");
  });

  it("auth header still offers Send a document", () => {
    render(createElement(SiteHeader, { variant: "auth" }));
    expect(screen.getByRole("link", { name: "Send a document" }).getAttribute("href")).toBe(
      "/",
    );
  });

  it("footer carries the tagline", () => {
    render(createElement(SiteFooter));
    expect(screen.getByText("Easy signing for everything.")).toBeTruthy();
  });

  it("footer leads with the machine links and keeps all five", () => {
    render(createElement(SiteFooter));
    const labels = screen
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual([
      "OpenAPI",
      "llms.txt",
      "Privacy",
      "Terms",
      "Pricing",
    ]);
  });
});
