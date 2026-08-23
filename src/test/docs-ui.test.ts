// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import DocsPage from "../../app/docs/page.js";

describe("docs page", () => {
  afterEach(() => cleanup());

  it("titles the page and links the machine surfaces", () => {
    render(createElement(DocsPage));
    expect(screen.getByRole("heading", { name: /docs/i })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /openapi schema/i }).getAttribute("href"),
    ).toBe("/openapi.json");
    expect(
      screen
        .getByRole("link", { name: /llms\.txt for your agent/i })
        .getAttribute("href"),
    ).toBe("/llms.txt");
  });

  it("tells the truth about keys", () => {
    render(createElement(DocsPage));
    const text = document.body.textContent ?? "";
    expect(text).toContain("sign_live_");
    expect(text).toContain("sign_tmp_");
    expect(text).toContain("sign_agent_");
    expect(text).toMatch(/cannot\s+send/i);
    expect(text).not.toMatch(/court|SOC 2|HIPAA|QES/);
  });

  it("shows the real endpoints as addresses", () => {
    render(createElement(DocsPage));
    const text = document.body.textContent ?? "";
    expect(text).toContain("POST /v1/documents");
    expect(text).toContain("GET /v1/documents/{id}");
    expect(text).toContain("POST /v1/verify");
  });
});
