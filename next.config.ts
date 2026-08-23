import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships wasm assets that must load from node_modules, not a bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
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
      // Pre-rename API paths keep working for callers minted before the deploy.
      {
        source: "/v1/envelopes/:id.pdf",
        destination: "/v1/documents/:id/pdf",
      },
      {
        source: "/v1/envelopes",
        destination: "/v1/documents",
      },
      {
        source: "/v1/envelopes/:path*",
        destination: "/v1/documents/:path*",
      },
      {
        source: "/v1/packets",
        destination: "/v1/templates",
      },
      {
        source: "/v1/packets/:path*",
        destination: "/v1/templates/:path*",
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/envelopes",
        destination: "/documents",
        permanent: true,
      },
      {
        source: "/packets",
        destination: "/templates",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
