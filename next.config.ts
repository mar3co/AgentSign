import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
