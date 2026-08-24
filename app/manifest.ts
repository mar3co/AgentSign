import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AgentSign",
    short_name: "AgentSign",
    description:
      "Easy signing for everything, by people and their AI agents.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#cc4416",
    icons: [
      {
        src: "/brand/png/favicon-32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        src: "/brand/png/apple-touch-icon-180.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/brand/png/tile-wax-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
