// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  TerminalCode,
  TerminalFooter,
  TerminalPanel,
} from "../../components/marketing/terminal-panel.js";
import { TwoReader } from "../../components/marketing/two-reader.js";
import {
  MCP_CLIENT_NAMES,
  McpClients,
} from "../../components/marketing/mcp-clients.js";
import { ValueBand } from "../../components/marketing/value-band.js";

afterEach(() => cleanup());

describe("TerminalPanel", () => {
  it("renders eyebrow, address, children, footer", () => {
    render(
      createElement(TerminalPanel, {
        eyebrow: "For agents & developers",
        address: "POST /v1/documents",
        footer: createElement("span", null, "footer-line"),
        children: createElement("code", null, "curl"),
      }),
    );
    expect(screen.getByText("For agents & developers")).toBeTruthy();
    expect(screen.getByText("POST /v1/documents")).toBeTruthy();
    expect(screen.getByText("curl")).toBeTruthy();
    expect(screen.getByText("footer-line")).toBeTruthy();
  });

  it("colors comments apart from commands", () => {
    const { container } = render(
      createElement(TerminalCode, {
        code: "# try this\n$ curl https://agentsign.co/v1/documents",
      }),
    );
    const spans = container.querySelectorAll("pre span");
    expect(spans[0]?.className).toContain("text-[#9bb6f0]");
    expect(spans[1]?.className).toContain("text-[#eef3fc]");
  });

  it("renders caller-supplied footer copy", () => {
    render(
      createElement(TerminalFooter, {
        children: createElement("p", null, "Schema for this send."),
      }),
    );
    expect(screen.getByText("Schema for this send.")).toBeTruthy();
  });
});

describe("TwoReader", () => {
  it("renders both columns and a mobile disclosure", () => {
    render(
      createElement(TwoReader, {
        human: createElement("p", null, "human side"),
        machine: createElement("p", null, "machine side"),
      }),
    );
    expect(screen.getByText("human side")).toBeTruthy();
    expect(screen.getAllByText("machine side").length).toBeGreaterThan(0);
    expect(screen.getByText("View as machine")).toBeTruthy();
  });
});

describe("McpClients", () => {
  it("names the popular MCP hosts without claiming a partnership", () => {
    const { container } = render(createElement(McpClients));
    expect(screen.getByText("Works over MCP")).toBeTruthy();
    expect(screen.getByLabelText("Works over MCP")).toBeTruthy();
    for (const name of MCP_CLIENT_NAMES) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(MCP_CLIENT_NAMES).toEqual([
      "Claude",
      "ChatGPT",
      "Grok",
      "Cursor",
      "Copilot",
      "Gemini",
    ]);
    expect(container.textContent).not.toMatch(/partner|official integration/i);
    expect(container.textContent).not.toContain("—");
  });

  it("drops the eyebrow when compact", () => {
    const { container } = render(createElement(McpClients, { compact: true }));
    expect(container.querySelector("[data-mcp-clients]")?.getAttribute("data-mcp-clients")).toBe(
      "compact",
    );
    expect(screen.queryByText("Works over MCP")).toBeNull();
    expect(screen.getByLabelText("Works over MCP")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
  });
});

describe("ValueBand", () => {
  it("renders the three locked value props", () => {
    render(createElement(ValueBand));
    expect(screen.getByText("Always free, open source")).toBeTruthy();
    expect(screen.getByText("No per-seat pricing")).toBeTruthy();
    expect(screen.getByText("For humans and agents alike")).toBeTruthy();
    expect(screen.queryByText(/Apache-2.0/)).toBeNull();
    expect(screen.queryByText(/self-host/i)).toBeNull();
    expect(screen.queryByText(/one pro price/i)).toBeNull();
    expect(screen.queryByText(/people sign by hand/i)).toBeNull();
  });

  it("is three titles, stacked, with no second lines", () => {
    const { container } = render(createElement(ValueBand));
    expect(container.firstElementChild?.className).toContain("grid-cols-1");
    expect(container.querySelectorAll("p").length).toBe(3);
  });
});
