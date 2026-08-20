// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CabinetList } from "../../app/envelopes/cabinet-list.js";

describe("CabinetList", () => {
  afterEach(() => {
    cleanup();
  });

  it("lists title and status and is not the homepage drop", () => {
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
      }),
    );

    expect(screen.getByText("Repair authorization")).toBeTruthy();
    expect(screen.getByText(/completed/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /download/i }).getAttribute("href")).toBe(
      "/v1/envelopes/env_1/pdf",
    );
    expect(screen.getByRole("button", { name: /void/i })).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole("heading", { name: /send a pdf/i })).toBeNull();
    expect(screen.queryByLabelText(/email me a link/i)).toBeNull();
  });

  it("hides Download on pending rows", () => {
    render(
      createElement(CabinetList, {
        envelopes: [
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

  it("hides Void for envelopes the user only signed", () => {
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
    expect(screen.getByRole("link", { name: /download/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /void/i })).toBeNull();
  });

  it("shows empty state copy when there are no envelopes", () => {
    render(createElement(CabinetList, { envelopes: [] }));
    expect(screen.getByText(/no envelopes yet/i)).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
