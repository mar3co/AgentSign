import type { NextConfig } from "next";

// Payloads loaded via runtime-computed paths the file tracer can't see.
// Globs must target pnpm's real store path: modules resolve there at
// runtime, and Vercel refuses file entries that cross the node_modules
// symlink.
// pdfjs needs more than its entry module: the fake worker is imported
// dynamically ("Setting up fake worker failed" -> every parse 400s), the
// @napi-rs/canvas polyfill loads via a platform-specific require
// ("DOMMatrix is not defined"), and fonts/cmaps/wasm/iccs are read from
// the package dir on demand.
// Patterns anchor to the versioned store dir (pkg@*) rather than .pnpm/**:
// a deep scan of the whole store per glob runs the build out of memory.
const PDFJS_DIR = "./node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist";
const PDFJS_TRACE = [
  `${PDFJS_DIR}/legacy/build/pdf.worker.mjs`,
  `${PDFJS_DIR}/standard_fonts/**/*`,
  `${PDFJS_DIR}/cmaps/**/*`,
  `${PDFJS_DIR}/wasm/**/*`,
  `${PDFJS_DIR}/iccs/**/*`,
  "./node_modules/.pnpm/@napi-rs+canvas*/node_modules/@napi-rs/canvas*/**/*",
];
// @sparticuz/chromium unpacks its browser from bin/ for DOCX conversion.
const CHROMIUM_TRACE = [
  "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**/*",
];

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
