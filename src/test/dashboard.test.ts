// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DashboardClient } from "../../app/dashboard/dashboard-client.js";

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

function statsOk() {
  return new Response(
    JSON.stringify({
      total: 2,
      by_status: { completed: 1, pending: 1 },
      sent: { this_month: 2, last_month: 0, agent_share: 0 },
      completed: { this_month: 1, last_month: 0 },
      daily: [{ date: "2026-08-23", human: 1, agent: 1, completed: 1 }],
      median_signing_hours: 24,
      shredding_soon: 1,
      webhooks_30d: { sent: 2, failed: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function envelopesOk() {
  return new Response(
    JSON.stringify({
      envelopes: [
        {
          id: "env_1",
          title: "Repair authorization",
          status: "completed",
          created_at: iso(2),
          signers: [
            {
              name: "Jane",
              kind: "human",
              email: "jane@example.com",
              signed_at: iso(1),
              attested_at: null,
            },
          ],
        },
        {
          id: "env_2",
          title: "Mutual NDA",
          status: "pending",
          created_at: iso(0),
          signers: [],
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("DashboardClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows stat cards, recent documents, and the status breakdown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url) === "/v1/stats") return statsOk();
        if (String(url) === "/v1/envelopes") return envelopesOk();
        if (String(url) === "/v1/activity") {
          return new Response(JSON.stringify({ events: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 404 });
      }),
    );
    render(createElement(DashboardClient));
    expect(await screen.findByText(/sent this month/i)).toBeTruthy();
    expect(screen.getByText(/completed this month/i)).toBeTruthy();
    expect(screen.getByText(/all envelopes/i)).toBeTruthy();
    expect(screen.getByText(/recent documents/i)).toBeTruthy();
    expect(screen.getByText("Repair authorization")).toBeTruthy();
    expect(screen.getByText("Mutual NDA")).toBeTruthy();
    expect(screen.getByText(/where envelopes stand/i)).toBeTruthy();
    // Overlay legend and the ops rows from /v1/stats.
    expect(screen.getByText(/human-only/i)).toBeTruthy();
    expect(screen.getByText(/with agents/i)).toBeTruthy();
    expect(screen.getByText(/median time to signed/i)).toBeTruthy();
    expect(screen.getByText("24 h")).toBeTruthy();
    expect(screen.getByText(/2 sent · 1 failed/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /open cabinet/i }).getAttribute("href"),
    ).toBe("/envelopes");
  });

  it("shows the empty note when nothing was sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body =
          String(url) === "/v1/stats"
            ? {
                total: 0,
                by_status: {},
                sent: { this_month: 0, last_month: 0, agent_share: 0 },
                completed: { this_month: 0, last_month: 0 },
                daily: [],
                median_signing_hours: null,
                shredding_soon: 0,
                webhooks_30d: { sent: 0, failed: 0 },
              }
            : String(url) === "/v1/envelopes"
              ? { envelopes: [] }
              : { events: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    render(createElement(DashboardClient));
    expect(await screen.findByText(/nothing sent yet/i)).toBeTruthy();
  });
});
