import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt =
  "Easy signing for everything, by people and their AI agents.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const tile = await readFile(
    join(process.cwd(), "public/brand/png/tile-wax-512.png"),
  );
  return new ImageResponse(
    (
      <div
        style={{
          background: "#faf9f6",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          gap: 28,
        }}
      >
        <img
          src={`data:image/png;base64,${tile.toString("base64")}`}
          width={88}
          height={88}
          alt=""
        />
        <div
          style={{
            display: "flex",
            fontSize: 64,
            fontWeight: 600,
            color: "#1c2733",
            letterSpacing: -1.5,
          }}
        >
          AgentSign
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "#5c6b7a",
            maxWidth: 820,
            lineHeight: 1.35,
          }}
        >
          Easy signing for everything, by people and their AI agents.
        </div>
      </div>
    ),
    { ...size },
  );
}
