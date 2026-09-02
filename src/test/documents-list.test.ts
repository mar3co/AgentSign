// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DocumentsClient } from "../../app/documents/documents-client.js";
import {
  DocumentsList,
  formatSentDate,
} from "../../app/documents/documents-list.js";

describe("formatSentDate", () => {
  it("uses the workspace timezone when given one", () => {
    const iso = "2026-01-15T02:00:00.000Z";
    expect(formatSentDate(iso, "UTC")).toMatch(/Jan 15/);
    expect(formatSentDate(iso, "America/Los_Angeles")).toMatch(/Jan 14/);
  });
});

describe("DocumentsClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("still lists documents if workspace timezone fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/documents")) {
          return new Response(
            JSON.stringify({
              documents: [
                { id: "env_1", title: "Repair authorization", status: "completed" },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error("workspace down");
      }),
    );
    render(createElement(DocumentsClient));
    expect(await screen.findByText("Repair authorization")).toBeTruthy();
    expect(screen.queryByText(/could not load documents/i)).toBeNull();
  });
});

describe("DocumentsList", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists title and status and is not the homepage drop", () => {
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
      }),
    );

    expect(screen.getByText("Repair authorization")).toBeTruthy();
    expect(screen.getByText(/completed/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /download/i }).getAttribute("href")).toBe(
      "/v1/documents/env_1/pdf",
    );
    expect(screen.getByRole("button", { name: /void/i })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole("heading", { name: /send a document/i })).toBeNull();
    expect(screen.queryByLabelText(/email me a link/i)).toBeNull();
  });

  it("hides Download on pending rows", () => {
    render(
      createElement(DocumentsList, {
        documents: [
          {
            id: "env_pending",
            title: "Repair authorization",
            status: "pending",
            canDelete: true,
          },
        ],
      }),
    );
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
    expect(screen.getByRole("button", { name: /void/i })).toBeTruthy();
  });

  it("hides Void for documents the user only signed", () => {
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
    expect(screen.getByRole("link", { name: /download/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /void/i })).toBeNull();
  });

  it("pages to and highlights the row a ?id= deep link names", () => {
    // Page size is 10, so the 12th document is off the first page until the
    // deep link jumps to it.
    const documents = Array.from({ length: 12 }, (_, i) => ({
      id: `env_${i}`,
      title: `Document ${i}`,
      status: "pending",
      createdAt: new Date(2026, 0, 12 - i).toISOString(),
    }));
    render(
      createElement(DocumentsList, { documents, focusId: "env_11" }),
    );
    const row = screen.getByText("Document 11").closest("tr");
    expect(row).toBeTruthy();
    expect(row!.className).toContain("bg-muted");
  });

  it("shows empty state copy when there are no documents", () => {
    render(createElement(DocumentsList, { documents: [] }));
    expect(screen.getByText(/no documents yet/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /send a document/i }).getAttribute("href")).toBe(
      "/send",
    );
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("lists each party with kind and signed vs attested", () => {
    render(
      createElement(DocumentsList, {
        documents: [
          {
            id: "env_mixed",
            title: "Repair authorization",
            status: "completed",
            canDelete: true,
            signers: [
              {
                name: "Grok Legal",
                kind: "agent",
                email: "shop@example.com",
                agent: "grok-legal",
                signed_at: null,
                attested_at: "2026-08-21T12:00:00.000Z",
              },
              {
                name: "Jane",
                kind: "human",
                email: "jane@example.com",
                signed_at: "2026-08-21T12:01:00.000Z",
                attested_at: null,
              },
            ],
          },
        ],
      }),
    );

    expect(screen.getByText("grok-legal · agent · attested")).toBeTruthy();
    expect(screen.getByText("Jane · human · signed")).toBeTruthy();
  });
});
