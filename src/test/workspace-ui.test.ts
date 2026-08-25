// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WorkspaceClient } from "../../app/settings/workspace/workspace-client.js";
import { SettingsShell } from "../../components/settings-shell.js";

const OWNER = {
  app_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  display_name: "Shop Co",
  timezone: "America/New_York",
  description: "Repair shop",
  role: "owner",
  can_edit: true,
};

const MEMBER = {
  ...OWNER,
  role: "member",
  can_edit: false,
};

function stubWorkspace(body: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("settings Workspace tab", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks Workspace current at /settings/workspace", () => {
    render(createElement(SettingsShell, { current: "workspace" }, "content"));
    expect(
      screen.getByRole("link", { name: /^workspace$/i }).getAttribute("href"),
    ).toBe("/settings/workspace");
    expect(
      screen.getByRole("link", { name: /^workspace$/i }).getAttribute("aria-current"),
    ).toBe("page");
  });
});

describe("WorkspaceClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows name, app id, timezone, description, export, and dissolve for the owner", async () => {
    stubWorkspace(OWNER);
    render(createElement(WorkspaceClient));
    expect(await screen.findByDisplayValue("Shop Co")).toBeTruthy();
    expect(screen.getByDisplayValue(OWNER.app_id)).toHaveProperty("disabled", true);
    expect(screen.getByLabelText(/^timezone$/i)).toBeTruthy();
    expect(screen.getByDisplayValue("Repair shop")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^export$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /dissolve team/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /leave team/i })).toBeNull();
    expect(screen.queryByText(/cabinet/i)).toBeNull();
  });

  it("lets a member export or leave, not edit or dissolve", async () => {
    stubWorkspace(MEMBER);
    render(createElement(WorkspaceClient));
    expect(await screen.findByDisplayValue("Shop Co")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /^export$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /leave team/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /dissolve team/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });
});
