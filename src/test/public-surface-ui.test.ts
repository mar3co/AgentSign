// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { PageShell } from "../../components/page-shell.js";

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

  it("does not mark app or ceremony variants", () => {
    for (const variant of ["app", "ceremony"] as const) {
      const { container } = render(
        createElement(PageShell, { variant, children: "hi" }),
      );
      expect(container.querySelector("[data-surface]")).toBeNull();
      cleanup();
    }
  });
});
