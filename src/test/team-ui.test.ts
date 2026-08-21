// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SiteHeader } from "../../components/site-header.js";
import { TeamAccept } from "../../app/team/accept/team-accept.js";
import { TeamClient } from "../../app/team/team-client.js";
import { TeamList } from "../../app/team/team-list.js";

const ownerMembers = [
  {
    id: "owner_1",
    email: "shop@example.com",
    status: "active" as const,
    role: "owner" as const,
  },
  {
    id: "mem_1",
    email: "tech@example.com",
    status: "invited" as const,
    role: "member" as const,
  },
];

describe("TeamList", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows upgrade link when not entitled", () => {
    render(createElement(TeamList, { entitled: false }));
    expect(screen.getByRole("link", { name: /upgrade/i }).getAttribute("href")).toBe(
      "/upgrade",
    );
    expect(screen.queryByRole("button", { name: /invite/i })).toBeNull();
  });

  it("shows invite form for the owner", () => {
    render(
      createElement(TeamList, {
        entitled: true,
        isOwner: true,
        members: ownerMembers,
      }),
    );
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /invite/i })).toBeTruthy();
    expect(screen.getByText("tech@example.com")).toBeTruthy();
  });

  it("hides invite form for a member", () => {
    render(
      createElement(TeamList, {
        entitled: true,
        isOwner: false,
        members: ownerMembers,
      }),
    );
    expect(screen.getByText("tech@example.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /invite/i })).toBeNull();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
  });

  it("inviting the same email twice shows one row", async () => {
    const invited = {
      id: "mem_1",
      email: "tech@example.com",
      status: "invited",
    };
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(JSON.stringify(invited), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      createElement(TeamList, {
        entitled: true,
        isOwner: true,
        members: [ownerMembers[0]!],
      }),
    );
    const input = screen.getByLabelText(/email/i);
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "tech@example.com" } });
    fireEvent.submit(form);
    expect(await screen.findByText("tech@example.com")).toBeTruthy();
    fireEvent.change(input, { target: { value: "tech@example.com" } });
    fireEvent.submit(form);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("tech@example.com")).toHaveLength(1);
  });
});

describe("cabinet Team link", () => {
  afterEach(() => {
    cleanup();
  });

  it("links Team to /team", () => {
    render(createElement(SiteHeader, { variant: "app" }));
    expect(screen.getAllByRole("link", { name: /^team$/i })[0]?.getAttribute("href")).toBe(
      "/team",
    );
  });
});

describe("TeamAccept", () => {
  afterEach(() => {
    cleanup();
  });

  it("links to login when needsLogin is true", () => {
    render(
      createElement(TeamAccept, {
        token: "tok_1",
        needsLogin: true,
      }),
    );
    const href = screen.getByRole("link", { name: /log in/i }).getAttribute("href");
    expect(href).toBeTruthy();
    const url = new URL(href!, "http://sign.test");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("email")).toBe("");
    expect(url.searchParams.get("next")).toBe("/team/accept?token=tok_1");
  });
});

describe("TeamClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders upgrade when GET entitled is false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            owner_email: "shop@example.com",
            members: ownerMembers.slice(0, 1),
            entitled: false,
            role: "owner",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    render(createElement(TeamClient));
    expect(await screen.findByRole("link", { name: /upgrade/i })).toBeTruthy();
  });

  it("hides invite form when GET role is member", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            owner_email: "shop@example.com",
            members: ownerMembers,
            entitled: true,
            role: "member",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    render(createElement(TeamClient));
    expect(await screen.findByText("tech@example.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /invite/i })).toBeNull();
  });
});
