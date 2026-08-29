import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships wasm assets that must load from node_modules, not a bundle;
  // @sparticuz/chromium and puppeteer-core ship their payloads the same way.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "pdfjs-dist",
    "@sparticuz/chromium",
    "puppeteer-core",
  ],
  // Payloads loaded via runtime-computed paths the file tracer can't see:
  // @sparticuz/chromium unpacks its browser from bin/, and pdfjs loads its
  // @napi-rs/canvas polyfill through a platform-specific require — without
  // it pdfjs throws "DOMMatrix is not defined" and every PDF parse 400s.
  // Globs must target pnpm's real store path: modules resolve there at
  // runtime, and Vercel refuses file entries that cross the node_modules
  // symlink.
  outputFileTracingIncludes: {
    "/v1/documents": [
      "./node_modules/.pnpm/**/node_modules/@sparticuz/chromium/bin/**/*",
      "./node_modules/.pnpm/**/node_modules/@napi-rs/canvas*/**/*",
    ],
    "/v1/templates": [
      "./node_modules/.pnpm/**/node_modules/@sparticuz/chromium/bin/**/*",
      "./node_modules/.pnpm/**/node_modules/@napi-rs/canvas*/**/*",
    ],
    "/v1/detect-fields": [
      "./node_modules/.pnpm/**/node_modules/@napi-rs/canvas*/**/*",
    ],
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
