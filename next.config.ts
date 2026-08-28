import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships wasm assets that must load from node_modules, not a bundle;
  // @sparticuz/chromium ships the Chromium binary the same way — without this
  // the deploy trace drops bin/ and DOCX conversion 503s in production.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "pdfjs-dist",
    "@sparticuz/chromium",
    "puppeteer-core",
  ],
  // The Chromium payload is unpacked via runtime-computed paths the file
  // tracer can't see; without this the DOCX routes deploy without a browser.
  outputFileTracingIncludes: {
    "/v1/documents": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/v1/templates": ["./node_modules/@sparticuz/chromium/bin/**/*"],
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
