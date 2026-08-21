// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentsClient } from "../../app/agents/agents-client.js";
import { AgentsList } from "../../app/agents/agents-list.js";
import { CabinetList } from "../../app/envelopes/cabinet-list.js";
import { AuthorizeForm } from "../../app/oauth/authorize/authorize-form.js";
import { SigningCeremony } from "../../app/s/[token]/signing-ceremony.js";

describe("AgentsList", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows upgrade link and no create form when not entitled", () => {
    render(createElement(AgentsList, { entitled: false }));
    expect(screen.getByRole("link", { name: /upgrade/i }).getAttribute("href")).toBe(
      "/upgrade",
    );
    expect(screen.queryByRole("button", { name: "Create agent" })).toBeNull();
    expect(screen.queryByLabelText(/slug/i)).toBeNull();
  });

  it('Pro owner contains "Create agent"', () => {
    render(
      createElement(AgentsList, {
        entitled: true,
        canEdit: true,
        agents: [],
      }),
    );
    expect(screen.getByRole("button", { name: "Create agent" })).toBeTruthy();
    expect(screen.getByLabelText(/slug/i)).toBeTruthy();
    expect(screen.getByLabelText(/^name$/i)).toBeTruthy();
  });

  it("hides create, rotate, and revoke when member cannot edit", () => {
    render(
      createElement(AgentsList, {
        entitled: true,
        canEdit: false,
        agents: [
          {
            id: "agt_1",
            slug: "grok-legal",
            name: "Grok Legal",
            has_webhook: false,
            revoked_at: null,
          },
        ],
      }),
    );
    expect(screen.getByText("grok-legal")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create agent" })).toBeNull();
    expect(screen.queryByRole("button", { name: /rotate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
  });

  it("empty Save webhook does not PUT null when a hook is already set", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      createElement(AgentsList, {
        entitled: true,
        canEdit: true,
        agents: [
          {
            id: "agt_1",
            slug: "grok-legal",
            name: "Grok Legal",
            has_webhook: true,
            revoked_at: null,
          },
        ],
      }),
    );
    const save = screen.getByRole("button", { name: "Save webhook" });
    fireEvent.submit(save.closest("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cabinet Agents link", () => {
  afterEach(() => {
    cleanup();
  });

  it("links Agents to /agents", () => {
    render(createElement(CabinetList, { envelopes: [] }));
    expect(screen.getByRole("link", { name: /^agents$/i }).getAttribute("href")).toBe(
      "/agents",
    );
  });
});

describe("AgentsClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("Free GET /agents contains upgrade", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Pro plan required", code: "pro_required" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(createElement(AgentsClient));
    expect(await screen.findByRole("link", { name: /upgrade/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create agent" })).toBeNull();
  });

  it('Pro owner contains "Create agent"', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ agents: [], can_edit: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(createElement(AgentsClient));
    expect(await screen.findByRole("button", { name: "Create agent" })).toBeTruthy();
  });

  it("renders member read-only when GET can_edit is false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            agents: [
              {
                id: "agt_1",
                slug: "grok-legal",
                name: "Grok Legal",
                has_webhook: false,
                revoked_at: null,
              },
            ],
            can_edit: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    render(createElement(AgentsClient));
    expect(await screen.findByText("grok-legal")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create agent" })).toBeNull();
  });
});

describe("AuthorizeForm", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows client name and Pro agent checkboxes named agent_ids[]", () => {
    render(
      createElement(AuthorizeForm, {
        clientName: "Grok",
        clientId: "cid",
        redirectUri: "https://client.example/cb",
        state: "xyz",
        codeChallenge: "challenge",
        resource: "https://sign.test/mcp",
        agents: [{ id: "agt_1", slug: "grok-legal", name: "Grok Legal" }],
      }),
    );
    expect(screen.getByText(/Grok wants to use your AgentSign account/)).toBeTruthy();
    const form = document.querySelector('form[action="/oauth/authorize"]');
    expect(form?.getAttribute("method")?.toLowerCase()).toBe("post");
    const box = document.querySelector('input[name="agent_ids[]"][value="agt_1"]');
    expect(box).toBeTruthy();
    expect((box as HTMLInputElement).checked).toBe(true);
  });

  it("hides attest checkboxes when there are no agents", () => {
    render(
      createElement(AuthorizeForm, {
        clientName: "Grok",
        clientId: "cid",
        redirectUri: "https://client.example/cb",
        state: "xyz",
        codeChallenge: "challenge",
        resource: "https://sign.test/mcp",
        agents: [],
      }),
    );
    expect(document.querySelector('input[name="agent_ids[]"]')).toBeNull();
  });
});

describe("ceremony earlier agent attestation", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows factual attested line, not electronically signed", () => {
    render(
      createElement(SigningCeremony, {
        token: "tok_1",
        consentText: "I agree",
        state: {
          title: "Repair authorization",
          signerName: "Jane",
          sequentialWait: false,
          expiresAt: "2026-08-27T00:00:00.000Z",
          attested: [{ slug: "grok-legal", email: "shop@example.com" }],
        },
      }),
    );
    expect(screen.getByText("grok-legal attested for shop@example.com")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/electronically signed/i);
  });
});
