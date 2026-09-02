// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConnectedAppsClient } from "../../app/settings/security/connected-apps-client.js";

const grant = {
  id: "3f6d9a2e-1c4b-4f8a-9d21-0b7c5e8a1f30",
  client_id: "https://claude.ai/mcp",
  client_name: "Claude Desktop",
  scopes: ["send", "status", "download"],
  agents: [{ id: "a1", slug: "grok-legal", name: "Grok Legal" }],
  created_at: "2026-08-20T10:00:00.000Z",
};

function stubFetch(grants: unknown[], calls: { url: string; method?: string }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ grants }), { status: 200 });
    }),
  );
}

describe("ConnectedAppsClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists a connected app and disconnects it after confirming", async () => {
    const calls: { url: string; method?: string }[] = [];
    stubFetch([grant], calls);
    render(createElement(ConnectedAppsClient));

    expect(await screen.findByText("Claude Desktop")).toBeTruthy();
    expect(screen.getByText("send, status, download")).toBeTruthy();
    expect(screen.getByText("Can attest as Grok Legal")).toBeTruthy();
    expect(screen.getByText(/^Connected \d/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm disconnect" }));

    const del = calls.find((c) => c.method === "DELETE");
    expect(del).toBeTruthy();
    expect(del!.url).toBe(`/v1/oauth/grants/${grant.id}`);
  });

  it("points at the MCP URL when nothing is connected", async () => {
    const calls: { url: string; method?: string }[] = [];
    stubFetch([], calls);
    render(createElement(ConnectedAppsClient));

    expect(await screen.findByText("No apps connected")).toBeTruthy();
    expect(
      screen.getByText(
        `Add ${window.location.origin}/mcp to an MCP host to connect one.`,
      ),
    ).toBeTruthy();
  });
});
