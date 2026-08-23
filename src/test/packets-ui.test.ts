// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CabinetList } from "../../app/envelopes/cabinet-list.js";
import { AppShell } from "../../components/app-shell.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "",
}));
import { PacketsClient } from "../../app/packets/packets-client.js";
import { PacketsList } from "../../app/packets/packets-list.js";

describe("PacketsList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows upgrade link and no file input when not entitled", () => {
    render(createElement(PacketsList, { entitled: false }));
    expect(screen.getByRole("link", { name: /upgrade/i }).getAttribute("href")).toBe(
      "/upgrade",
    );
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("shows packet titles when entitled", () => {
    render(
      createElement(PacketsList, {
        entitled: true,
        packets: [{ id: "pkt_1", title: "Repair packet", roles: [] }],
      }),
    );
    expect(screen.getByText("Repair packet")).toBeTruthy();
  });

  it("shows one name and email pair per role", () => {
    render(
      createElement(PacketsList, {
        entitled: true,
        packets: [
          {
            id: "pkt_1",
            title: "Repair packet",
            roles: [
              { signing_order: 1, role_name: "Customer" },
              { signing_order: 2, role_name: "Shop" },
            ],
          },
        ],
      }),
    );
    expect(screen.getByLabelText(/customer name/i)).toBeTruthy();
    expect(screen.getByLabelText(/customer email/i)).toBeTruthy();
    expect(screen.getByLabelText(/shop name/i)).toBeTruthy();
    expect(screen.getByLabelText(/shop email/i)).toBeTruthy();
  });
});

describe("cabinet Packets link", () => {
  afterEach(() => {
    cleanup();
  });

  it("links Packets to /packets from the app sidebar", () => {
    render(createElement(AppShell, null, "content"));
    expect(screen.getAllByRole("link", { name: /^packets$/i })[0]?.getAttribute("href")).toBe(
      "/packets",
    );
  });

  it("Save as packet on completed canDelete rows", () => {
    const onSavePacket = vi.fn();
    render(
      createElement(CabinetList, {
        envelopes: [
          {
            id: "env_1",
            title: "Repair authorization",
            status: "completed",
            canDelete: true,
          },
        ],
        onSavePacket,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /save as packet/i }));
    expect(onSavePacket).toHaveBeenCalledWith("env_1");
  });

  it("hides Save as packet when the user only signed", () => {
    render(
      createElement(CabinetList, {
        envelopes: [
          {
            id: "env_2",
            title: "Repair authorization",
            status: "completed",
            canDelete: false,
          },
        ],
      }),
    );
    expect(screen.queryByRole("button", { name: /save as packet/i })).toBeNull();
  });
});

describe("PacketsClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders upgrade when GET is 403 pro_required", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Pro plan required", code: "pro_required" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(createElement(PacketsClient));
    expect(await screen.findByRole("link", { name: /upgrade/i })).toBeTruthy();
  });

  it("renders packet titles from GET /v1/packets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            packets: [
              {
                id: "pkt_1",
                title: "Repair packet",
                roles: [{ signing_order: 1, role_name: "Customer" }],
                created_at: "2026-08-20T00:00:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    render(createElement(PacketsClient));
    expect(await screen.findByText("Repair packet")).toBeTruthy();
  });
});
