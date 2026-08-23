// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Home from "../../app/page.js";

afterEach(() => cleanup());

describe("home scroll story", () => {
  it("asks the visitor's questions and answers them", () => {
    render(createElement(Home));
    expect(screen.getByText("So what is this?")).toBeTruthy();
    expect(screen.getByText("What do agents have to do with it?")).toBeTruthy();
    expect(screen.getByText("Why believe any of it?")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Accounts are optional" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "It speaks agent and developer" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /the file is the proof/i }),
    ).toBeTruthy();
  });

  it("renders the ledger rows for every chapter", () => {
    render(createElement(Home));
    for (const label of [
      "SENT",
      "SIGNED",
      "SEALED",
      "PEOPLE",
      "AGENTS",
      "DEVELOPERS",
      "THE SEAL",
      "THE SIGNATURES",
      "THE RECEIPTS",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(
      screen.getByText(/we shred our copy in seven days unless you keep it/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/never a faked signature/i),
    ).toBeTruthy();
  });

  it("keeps the send bar a pointer for developers, not a terminal", () => {
    render(createElement(Home));
    const bar = screen.getByText("send from code:").closest("p");
    expect(bar?.textContent).toContain("POST /v1/documents");
    // The bar itself never contains a curl invocation.
    expect(bar?.textContent).not.toMatch(/curl/i);
    const openapi = screen
      .getAllByRole("link", { name: "OpenAPI" })
      .map((a) => a.getAttribute("href"));
    expect(openapi).toContain("/openapi.json");
  });

  it("gives each chapter its own primary CTA", () => {
    render(createElement(Home));
    // Chapter 1's CTA is the send action itself; 2 and 3 are links.
    expect(
      screen.getAllByRole("button", { name: "Choose a PDF" }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen
        .getByRole("link", { name: "Connect your AI agent" })
        .getAttribute("href"),
    ).toBe("/llms.txt");
    expect(
      screen.getByRole("link", { name: "See pricing" }).getAttribute("href"),
    ).toBe("/upgrade");
  });

  it("shows a real call per chapter, twice (pinned panel and stacked fallback)", () => {
    render(createElement(Home));
    for (const address of [
      "GET /v1/documents/{id}",
      "POST /v1/documents/{id}/attest",
      "POST /v1/verify",
    ]) {
      // One copy in the pinned terminal stack, one in the disclosure fallback.
      expect(screen.getAllByText(address)).toHaveLength(2);
    }
    expect(screen.getAllByText(/anyone can run this\. no key\./i).length).toBe(2);
    expect(
      screen.getAllByText(/kept 7 days unless you keep it/i).length,
    ).toBe(2);
  });

  it("ends with the band as the only footer", () => {
    render(createElement(Home));
    // PageShell's footer is suppressed; the band's footer row is the one footer.
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Privacy" }).getAttribute("href"),
    ).toBe("/privacy");
    expect(screen.getByText("Always free, open source")).toBeTruthy();
    expect(screen.getByText("Team plans, no per-seat pricing")).toBeTruthy();
    expect(screen.getByText("For humans and agents alike")).toBeTruthy();
  });

  it("holds the voice rules", () => {
    const { container } = render(createElement(Home));
    const text = container.textContent ?? "";
    expect(text.toLowerCase()).not.toContain("a human signs");
    // No em dashes anywhere in the page copy.
    expect(text).not.toContain("—");
    // "attest" appears only inside verbatim code blocks.
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("pre, code").forEach((el) => el.remove());
    expect(clone.textContent ?? "").not.toMatch(/attest/i);
  });
});
