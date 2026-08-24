// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Home from "../../app/page.js";

afterEach(() => cleanup());

describe("home hero", () => {
  it("renders the locked headline", () => {
    render(createElement(Home));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Easy signing for everything",
    );
  });

  it("mirrors the signer name into the curl pane", () => {
    render(createElement(Home));
    fireEvent.click(screen.getAllByText("Choose a PDF")[0]!);
    const name = screen.getByLabelText("Signer name");
    fireEvent.change(name, { target: { value: "Ada" } });
    const pane = document.querySelector("pre");
    expect(pane?.textContent).toContain('"name":"Ada"');
  });

  it("never says a human signs", () => {
    const { container } = render(createElement(Home));
    expect(container.textContent?.toLowerCase()).not.toContain("a human signs");
  });

  it("lets the agent send without claiming it signs", () => {
    const { container } = render(createElement(Home));
    const hero = container.querySelector("[data-hero]");
    expect(hero?.textContent).toMatch(/let your agent send it/i);
    expect(hero?.textContent).not.toMatch(/handle signing/i);
    expect(hero?.textContent).not.toMatch(/agents? sign the/i);
  });
});
