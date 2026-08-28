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
  // The Chromium payload is unpacked via runtime-computed paths the file
  // tracer can't see; without this the DOCX routes deploy without a browser
  // and every DOCX upload 503s in production. The glob must target pnpm's
  // real store path: the module resolves there at runtime, and Vercel
  // refuses packages whose file entries cross the node_modules symlink.
  outputFileTracingIncludes: {
    "/v1/documents": [
      "./node_modules/.pnpm/**/node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/v1/templates": [
      "./node_modules/.pnpm/**/node_modules/@sparticuz/chromium/bin/**/*",
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
