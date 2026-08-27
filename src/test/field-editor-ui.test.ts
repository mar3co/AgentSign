// @vitest-environment happy-dom
import { createElement, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FieldOverlay } from "../../app/send/field-editor/overlay.js";
import { FieldPalette } from "../../app/send/field-editor/palette.js";
import {
  makePlacedField,
  type PlacedField,
} from "../../app/send/field-model.js";

function Harness({ placing }: { placing: boolean }) {
  const [fields, setFields] = useState<PlacedField[]>([]);
  return createElement(
    "div",
    { style: { position: "relative", width: "600px", height: "800px" } },
    createElement(FieldOverlay, {
      pageIndex: 0,
      fields,
      placing: placing ? { signerIndex: 0, type: "signature" as const } : null,
      onPlace: (f: PlacedField) => setFields((p) => [...p, f]),
      onChange: (f: PlacedField) =>
        setFields((p) => p.map((x) => (x.id === f.id ? f : x))),
      onDelete: (id: string) => setFields((p) => p.filter((x) => x.id !== id)),
    }),
  );
}

describe("field editor", () => {
  afterEach(() => cleanup());

  it("palette lists the six types and the signers", () => {
    render(
      createElement(FieldPalette, {
        signers: [{ name: "Jane", email: "jane@example.com" }],
        activeSigner: 0,
        onSignerChange: () => {},
        activeType: null,
        onTypeChange: () => {},
      }),
    );
    for (const label of [/signature/i, /initials/i, /date/i, /name/i, /text/i, /checkbox/i]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByText(/jane/i)).toBeTruthy();
  });

  it("click places a field when placement is armed", () => {
    render(createElement(Harness, { placing: true }));
    fireEvent.click(screen.getByTestId("field-layer"), {
      clientX: 300,
      clientY: 400,
    });
    expect(screen.getByText(/signature/i)).toBeTruthy();
  });

  it("click does nothing when placement is off", () => {
    render(createElement(Harness, { placing: false }));
    fireEvent.click(screen.getByTestId("field-layer"), {
      clientX: 300,
      clientY: 400,
    });
    expect(screen.queryByText(/signature/i)).toBeNull();
  });

  it("delete removes the field", () => {
    render(createElement(Harness, { placing: true }));
    fireEvent.click(screen.getByTestId("field-layer"), { clientX: 300, clientY: 400 });
    fireEvent.click(screen.getByRole("button", { name: /delete field/i }));
    expect(screen.queryByText(/signature/i)).toBeNull();
  });
});
