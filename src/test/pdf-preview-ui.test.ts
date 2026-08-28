// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
      scale,
    }),
    render: () => ({ promise: Promise.resolve() }),
  };
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => page,
      }),
    }),
  };
});

import { PdfPreview } from "../../app/send/pdf-preview.js";

function pdfFile() {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", {
    type: "application/pdf",
  });
}

describe("PdfPreview", () => {
  afterEach(() => cleanup());

  it("renders one image per page with page markers", async () => {
    render(createElement(PdfPreview, { file: pdfFile() }));
    await waitFor(() =>
      expect(document.querySelectorAll("[data-page]").length).toBe(2),
    );
    expect(document.querySelector('[data-page="1"] img')).toBeTruthy();
  });

  it("shows a notice when rendering fails, without throwing", async () => {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
    vi.spyOn(mod, "getDocument").mockImplementationOnce(() => {
      throw new Error("bad pdf");
    });
    render(createElement(PdfPreview, { file: pdfFile() }));
    await screen.findByText(/preview unavailable/i);
  });
});
