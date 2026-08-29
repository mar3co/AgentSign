import type { NextConfig } from "next";

// Payloads loaded via runtime-computed paths the file tracer can't see.
// pdfjs needs more than its entry module: the fake worker is imported
// dynamically ("Setting up fake worker failed" -> every parse 400s), the
// @napi-rs/canvas polyfill loads via a platform-specific require
// ("DOMMatrix is not defined"), and fonts/cmaps/wasm/iccs are read from
// the package dir on demand. Plain node_modules paths are real files here:
// pnpm runs with nodeLinker hoisted (see pnpm-workspace.yaml) because
// Vercel's packager rejects traces that cross pnpm's store symlinks.
const PDFJS_TRACE = [
  "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "./node_modules/pdfjs-dist/standard_fonts/**/*",
  "./node_modules/pdfjs-dist/cmaps/**/*",
  "./node_modules/pdfjs-dist/wasm/**/*",
  "./node_modules/pdfjs-dist/iccs/**/*",
  "./node_modules/@napi-rs/canvas*/**/*",
];
// @sparticuz/chromium unpacks its browser from bin/ for DOCX conversion.
const CHROMIUM_TRACE = ["./node_modules/@sparticuz/chromium/bin/**/*"];

const nextConfig: NextConfig = {
  // PGlite ships wasm assets that must load from node_modules, not a bundle;
  // @sparticuz/chromium and puppeteer-core ship their payloads the same way.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "pdfjs-dist",
    "@napi-rs/canvas",
    "@sparticuz/chromium",
    "puppeteer-core",
  ],
  outputFileTracingIncludes: {
    "/v1/documents": [...CHROMIUM_TRACE, ...PDFJS_TRACE],
    "/v1/templates": [...CHROMIUM_TRACE, ...PDFJS_TRACE],
    "/v1/detect-fields": PDFJS_TRACE,
  },
  // app/** imports src/** with .js (NodeNext); webpack needs the same alias Vitest has.
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  async rewrites() {
    return [
      {
        source: "/v1/documents/:id.pdf",
        destination: "/v1/documents/:id/pdf",
      },
    ];
  },
};

export default nextConfig;
