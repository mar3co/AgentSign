// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CabinetList } from "../../app/envelopes/cabinet-list.js";

describe("CabinetList", () => {
  it("lists title and status and is not the homepage drop", () => {
    render(
      createElement(CabinetList, {
        envelopes: [
          {
            id: "env_1",
            title: "Repair authorization",
            status: "completed",
          },
        ],
      }),
    );

    expect(screen.getByText("Repair authorization")).toBeTruthy();
    expect(screen.getByText(/completed/i)).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole("heading", { name: /send a pdf/i })).toBeNull();
    expect(screen.queryByLabelText(/email me a link/i)).toBeNull();
  });

  it("shows empty state copy when there are no envelopes", () => {
    render(createElement(CabinetList, { envelopes: [] }));
    expect(screen.getByText(/no envelopes yet/i)).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
