import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Big_Shoulders,
  Geist,
  IBM_Plex_Mono,
  IBM_Plex_Serif,
  Public_Sans,
} from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const sans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-sans-face",
});

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-face",
});

const display = Big_Shoulders({
  subsets: ["latin"],
  variable: "--font-heading-face",
  adjustFontFallback: false,
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-face",
});

const serif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif-face",
});

const description =
  "Easy signing for everything, by people and their AI agents.";

export const metadata: Metadata = {
  metadataBase: new URL("https://agentsign.co"),
  title: {
    default: "AgentSign",
    template: "%s · AgentSign",
  },
  description,
  openGraph: {
    title: "AgentSign",
    description,
    url: "/",
    siteName: "AgentSign",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(
        "font-sans",
        sans.variable,
        geist.variable,
        display.variable,
        mono.variable,
        serif.variable,
      )}
    >
      <body>{children}</body>
    </html>
  );
}
