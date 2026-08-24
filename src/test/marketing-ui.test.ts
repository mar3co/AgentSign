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

describe("ValueBand", () => {
  it("renders the three locked value props", () => {
    render(createElement(ValueBand));
    expect(screen.getByText("Always free, open source")).toBeTruthy();
    expect(screen.getByText("Team plans, no per-seat pricing")).toBeTruthy();
    expect(screen.getByText("For humans and agents alike")).toBeTruthy();
    expect(screen.getByText(/Apache-2.0/)).toBeTruthy();
  });

  it("stacks in the left column and keeps one-liners until xl", () => {
    const { container } = render(createElement(ValueBand, { stacked: true }));
    const body = screen.getByText(/Apache-2.0/);
    expect(body.className).toContain("hidden");
    expect(body.className).toContain("xl:block");
    expect(container.firstElementChild?.className).toContain("grid-cols-1");
  });
});
