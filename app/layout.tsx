import type { Metadata, Viewport } from "next";
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

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#1c2733" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL("https://agentsign.co"),
  applicationName: "AgentSign",
  title: {
    default: "AgentSign",
    template: "%s · AgentSign",
  },
  description,
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { url: "/icon.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/png/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    title: "AgentSign",
    capable: true,
    statusBarStyle: "default",
  },
  openGraph: {
    title: "AgentSign",
    description,
    url: "/",
    siteName: "AgentSign",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentSign",
    description,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(
        "antialiased font-sans",
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
