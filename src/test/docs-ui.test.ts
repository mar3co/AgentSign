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

  it("documents MCP under a linkable anchor", () => {
    render(createElement(DocsPage));
    const mcp = document.getElementById("mcp");
    expect(mcp?.textContent).toMatch(/mcp/i);
    expect(document.getElementById("agents")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /connect over mcp/i }).getAttribute("href"),
    ).toBe("#mcp");
    const text = document.body.textContent ?? "";
    expect(text).toContain("claude mcp add --transport http openseal");
    expect(text).toContain('"mcpServers"');
    expect(text).toContain("/.well-known/oauth-authorization-server");
    expect(text).toContain("/oauth/register");
    const mcpSection = mcp?.nextElementSibling;
    const codeTexts = Array.from(
      mcpSection?.querySelectorAll("code") ?? [],
    ).map((el) => el.textContent?.trim());
    for (const tool of [
      "send",
      "status",
      "download",
      "attest",
      "reject",
      "verify",
      "list_templates",
      "send_template",
    ]) {
      expect(codeTexts).toContain(tool);
    }
    expect(text).toMatch(/no\s+sign\s+tool/i);
  });

  it("documents agent parties without calling attestation signing", () => {
    render(createElement(DocsPage));
    const text = document.body.textContent ?? "";
    expect(text).toContain("party.ready");
    expect(text).toContain("document.completed");
    expect(text).toContain("document.declined");
    expect(text).toContain("document.expired");
    expect(text).toContain("X-Sign-Signature");
    expect(text).toContain("X-Sign-Timestamp");
    expect(text).toContain("pending_sender");
    for (const code of [
      "human_required",
      "cannot_attest",
      "unknown_agent",
      "agent_limit",
      "pro_required",
      "flag_off",
      "invalid_request",
      "slug_taken",
    ]) {
      expect(text).toContain(code);
    }
    expect(text).not.toMatch(/agents signed/i);
    expect(text).not.toMatch(/signed off/i);
  });

  it("shows the real endpoints as addresses", () => {
    render(createElement(DocsPage));
    const text = document.body.textContent ?? "";
    expect(text).toContain("POST /v1/documents");
    expect(text).toContain("GET /v1/documents/{id}");
    expect(text).toContain("POST /v1/verify");
  });
});
