// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SendingClient } from "../../app/settings/security/sending-client.js";

describe("SendingClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the account's settings and saves a toggle", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (init?.method === "PATCH") {
          return new Response(
            JSON.stringify({
              confirm_agent_sends: true,
              confirm_human_sends: true,
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            confirm_agent_sends: true,
            confirm_human_sends: false,
          }),
          { status: 200 },
        );
      }),
    );
    render(createElement(SendingClient));
    const agent = await screen.findByRole("checkbox", { name: /confirm agent sends/i });
    expect(agent.getAttribute("aria-checked")).toBe("true");
    const human = screen.getByRole("checkbox", { name: /confirm my sends/i });
    expect(human.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(human);
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(JSON.parse(String(patch!.init!.body))).toEqual({
      confirm_human_sends: true,
    });
    expect(
      (await screen.findByRole("checkbox", { name: /confirm my sends/i })).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
  });
});
