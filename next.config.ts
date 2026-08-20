import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // app/** imports src/** with .js (NodeNext); webpack needs the same alias Vitest has.
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  async rewrites() {
    return [
      {
        source: "/v1/envelopes/:id.pdf",
        destination: "/v1/envelopes/:id/pdf",
      },
    ];
  },
};

export default nextConfig;
