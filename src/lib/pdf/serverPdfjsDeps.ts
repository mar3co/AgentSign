/**
 * Server-only. pdf.mjs pulls its canvas polyfill and fake worker in through
 * computed paths the deployment file tracer can't follow, so the deployed
 * function is missing them and every parse throws. Importing them here with
 * literal specifiers gets them traced and shipped whatever the builder's
 * store layout. Never import from client code: canvas is a native module.
 */
export async function primePdfjsRuntime(): Promise<void> {
  try {
    await import("@napi-rs/canvas");
  } catch {
    // Without the native polyfill pdf.mjs crashes on a bare DOMMatrix
    // reference at import time. Text extraction never renders, so inert
    // stubs keep parsing working wherever the binding is unavailable.
    const g = globalThis as Record<string, unknown>;
    g.DOMMatrix ??= class DOMMatrix {};
    g.Path2D ??= class Path2D {};
    g.ImageData ??= class ImageData {};
  }
  // @ts-expect-error -- ships no type declarations; imported so the tracer
  // bundles the module pdfjs's fake worker loads at parse time.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
}
