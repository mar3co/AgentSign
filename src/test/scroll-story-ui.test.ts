// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Home from "../../app/page.js";
import { PIN_SEND_BAR } from "../../components/marketing/scroll-story.js";

afterEach(() => cleanup());

describe("home scroll story", () => {
  it("snaps each chapter and the value band without overlapping headings", () => {
    const { container } = render(createElement(Home));
    const chapters = container.querySelectorAll("[data-chapter]");
    expect(chapters.length).toBe(3);
    for (const chapter of chapters) {
      expect(chapter.className).toContain("snap-start");
      expect(chapter.className).not.toContain("200px");
    }
    const band = container.querySelector("[data-hero] [data-value-band]");
    expect(band).toBeTruthy();
    expect(band?.className).not.toContain("snap-start");
    expect(container.querySelector("[data-story-end]")).toBeTruthy();
    expect(container.querySelector("[data-drop-zone]")).toBeTruthy();
    expect(PIN_SEND_BAR).toBe(false);
    expect(container.querySelector("[data-send-bar]")).toBeNull();
  });

  it("fills the first viewport and points down into the story", () => {
    const { container } = render(createElement(Home));
    const hero = container.querySelector("[data-hero]");
    expect(hero).toBeTruthy();
    const inner = hero?.firstElementChild;
    expect(inner?.className).toContain("justify-start");
    expect(inner?.className).toMatch(/\bpt-4\b/);
    expect(inner?.className).toContain("lg:pt-[calc(2rem+1.25rem+2px)]");
    expect(inner?.className).toContain("xl:pt-[calc(2rem+1.5rem+2px)]");
    expect(inner?.className).not.toContain("justify-center");
    expect(hero?.querySelector("[data-value-band]")).toBeTruthy();
    expect(hero?.textContent).toContain("Always free, open source");
    expect(
      container.querySelector("[data-hero] a[href='#story']"),
    ).toBeTruthy();
    expect(
      container.querySelector("[data-story-terminal] a[href='#story']"),
    ).toBeTruthy();
    expect(container.querySelector("#story")).toBeTruthy();
  });

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

  it("points the send panel at its own schema, not a kitchen-sink footer", () => {
    const { container } = render(createElement(Home));
    const hero = container.querySelector("[data-hero-terminal]");
    expect(hero?.textContent).toMatch(/schema/i);
    expect(
      hero?.querySelector("a[href='/openapi.json']")?.textContent,
    ).toMatch(/openapi\.json/i);
    expect(hero?.textContent).not.toMatch(/same pdf as a call/i);
    expect(hero?.textContent).not.toContain("SELF_HOST=1");
  });

  it("shows MCP hosts on the hero and the agent chapter", () => {
    const { container } = render(createElement(Home));
    const hero = container.querySelector("[data-hero]");
    const agent = container.querySelector("[data-chapter='1']");
    expect(hero?.querySelector("[data-mcp-clients='compact']")).toBeTruthy();
    expect(
      hero?.querySelector("[data-mcp-clients='compact']")?.className,
    ).toContain("max-sm:hidden");
    expect(agent?.querySelector("[data-mcp-clients]")).toBeTruthy();
    expect(agent?.textContent).toContain("Works over MCP");
    for (const name of ["Claude", "ChatGPT", "Grok", "Cursor", "Copilot", "Gemini"]) {
      expect(hero?.textContent).toContain(name);
      expect(agent?.textContent).toContain(name);
    }
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
    ).toBe("/docs#mcp");
    expect(
      screen.getByRole("link", { name: "See pricing" }).getAttribute("href"),
    ).toBe("/upgrade");
  });

  it("pins one terminal shell and mounts the hero call first", () => {
    const { container } = render(createElement(Home));
    const col = container.querySelector("[data-story-terminal]");
    expect(col).toBeTruthy();
    expect(col?.className).toContain("sticky");
    const shell = col?.querySelector("[data-terminal-shell]");
    expect(shell).toBeTruthy();
    expect(shell?.className).toContain("h-full");
    const heroWrap = col?.querySelector("[data-hero-terminal]");
    expect(heroWrap).toBeTruthy();
    expect(heroWrap?.getAttribute("data-terminal-swap")).toBeNull();
    expect(col?.querySelectorAll("[data-chapter-terminal]").length).toBe(0);
    expect(col?.textContent).toMatch(/for agents & developers/i);
    expect(col?.textContent).toMatch(/post \/v1\/documents/i);
    expect(col?.textContent).not.toMatch(/your agent's turn/i);
    expect(col?.innerHTML).not.toContain("--hero-south-h");
    expect(col?.innerHTML).not.toContain("duration-500");
  });

  it("shows a real call per chapter in the stacked fallback", () => {
    render(createElement(Home));
    for (const address of [
      "GET /v1/documents/{id}",
      "POST /v1/documents/{id}/attest",
      "POST /v1/verify",
    ]) {
      expect(screen.getAllByText(address).length).toBeGreaterThanOrEqual(1);
    }
    expect(
      screen.getAllByText(/anyone can run this\. no key\./i).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/kept 7 days unless you keep it/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("ends with one footer and keeps the value strip in the hero", () => {
    const { container } = render(createElement(Home));
    // PageShell's footer is suppressed; ScrollStory renders the one footer.
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Privacy" }).getAttribute("href"),
    ).toBe("/privacy");
    const south = container.querySelector("[data-hero-south]");
    expect(south?.className).not.toContain("w-screen");
    const heroBand = container.querySelector("[data-hero] [data-value-band]");
    expect(heroBand?.firstElementChild?.className).toContain("grid-cols-1");
    expect(heroBand?.textContent).toContain("Always free, open source");
    expect(heroBand?.textContent).toContain("No per-seat pricing");
    expect(heroBand?.textContent).toContain("For humans and agents alike");
    expect(heroBand?.textContent).not.toContain("Apache-2.0");
    const endBand = container.querySelector("[data-story-end]");
    expect(endBand?.textContent).not.toContain("Apache-2.0");
    expect(endBand?.textContent).not.toContain("Always free, open source");
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
