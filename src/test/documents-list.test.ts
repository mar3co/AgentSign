// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
    expect(screen.queryByRole("heading", { name: /send a pdf/i })).toBeNull();
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

  it("shows empty state copy when there are no documents", () => {
    render(createElement(DocumentsList, { documents: [] }));
    expect(screen.getByText(/no documents yet/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /send a pdf/i }).getAttribute("href")).toBe(
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
