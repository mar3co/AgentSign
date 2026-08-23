// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DocumentsList } from "../../app/documents/documents-list.js";
import { AppShell } from "../../components/app-shell.js";

vi.mock("next/navigation", () => ({
  usePathname: () => "",
}));
import { TemplatesClient } from "../../app/templates/templates-client.js";
import { TemplatesList } from "../../app/templates/templates-list.js";

describe("TemplatesList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows upgrade link and no file input when not entitled", () => {
    render(createElement(TemplatesList, { entitled: false }));
    expect(screen.getByRole("link", { name: /upgrade/i }).getAttribute("href")).toBe(
      "/upgrade",
    );
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("shows template titles when entitled", () => {
    render(
      createElement(TemplatesList, {
        entitled: true,
        templates: [{ id: "pkt_1", title: "Repair template", roles: [] }],
      }),
    );
    expect(screen.getByText("Repair template")).toBeTruthy();
  });

  it("shows one name and email pair per role", () => {
    render(
      createElement(TemplatesList, {
        entitled: true,
        templates: [
          {
            id: "pkt_1",
            title: "Repair template",
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

describe("sidebar Templates link", () => {
  afterEach(() => {
    cleanup();
  });

  it("links Templates to /templates from the app sidebar", () => {
    render(createElement(AppShell, null, "content"));
    expect(screen.getAllByRole("link", { name: /^templates$/i })[0]?.getAttribute("href")).toBe(
      "/templates",
    );
  });

  it("Save as template on completed canDelete rows", () => {
    const onSaveTemplate = vi.fn();
    render(
      createElement(DocumentsList, {
        documents: [
          {
            id: "env_1",
            title: "Repair authorization",
            status: "completed",
            canDelete: true,
          },
        ],
        onSaveTemplate,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /save as template/i }));
    expect(onSaveTemplate).toHaveBeenCalledWith("env_1");
  });

  it("hides Save as template when the user only signed", () => {
    render(
      createElement(DocumentsList, {
        documents: [
          {
            id: "env_2",
            title: "Repair authorization",
            status: "completed",
            canDelete: false,
          },
        ],
      }),
    );
    expect(screen.queryByRole("button", { name: /save as template/i })).toBeNull();
  });
});

describe("TemplatesClient", () => {
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
    render(createElement(TemplatesClient));
    expect(await screen.findByRole("link", { name: /upgrade/i })).toBeTruthy();
  });

  it("renders template titles from GET /v1/templates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            templates: [
              {
                id: "pkt_1",
                title: "Repair template",
                roles: [{ signing_order: 1, role_name: "Customer" }],
                created_at: "2026-08-20T00:00:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    render(createElement(TemplatesClient));
    expect(await screen.findByText("Repair template")).toBeTruthy();
  });
});
