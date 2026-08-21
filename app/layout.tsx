import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Big_Shoulders, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const sans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-sans-face",
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

export const metadata: Metadata = {
  title: {
    default: "AgentSign",
    template: "%s · AgentSign",
  },
  description: "Send a PDF. A human signs. You get a sealed file.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={cn("font-sans", sans.variable, display.variable, mono.variable)}
    >
      <body>{children}</body>
    </html>
  );
}
