import { afterEach, describe, expect, it } from "vitest";
import { loadPdfjs } from "../../app/lib/load-pdfjs.js";

// pdfjs-dist itself defaults GlobalWorkerOptions.workerSrc to "./pdf.worker.mjs"
// as soon as it's imported under Node (its own process-based isNodeJS check,
// independent of `window`), and that module-level side effect only runs once
// per process. So to observe our own window-gated assignment in this node-env
// suite, each browser-emulation test clears workerSrc back to "" first, which
// is exactly the falsy starting state a real (non-Node) browser bundle has.
describe("loadPdfjs", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("resolves to a pdfjs module exposing getDocument and GlobalWorkerOptions", async () => {
    const pdfjs = await loadPdfjs();
    expect(typeof pdfjs.getDocument).toBe("function");
    expect(pdfjs.GlobalWorkerOptions).toBeDefined();
  });

  it("sets GlobalWorkerOptions.workerSrc under a defined window", async () => {
    (globalThis as { window?: unknown }).window = {} as never;
    const pdfjs = await loadPdfjs();
    pdfjs.GlobalWorkerOptions.workerSrc = "";
    await loadPdfjs();
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toEqual(
      expect.stringMatching(/pdf\.worker\.min\.mjs$/),
    );
  });

  it("does not overwrite an already-set workerSrc on a second call", async () => {
    (globalThis as { window?: unknown }).window = {} as never;
    const first = await loadPdfjs();
    first.GlobalWorkerOptions.workerSrc = "";
    await loadPdfjs();
    const workerSrc = first.GlobalWorkerOptions.workerSrc;
    const second = await loadPdfjs();
    expect(second.GlobalWorkerOptions.workerSrc).toBe(workerSrc);
  });
});
