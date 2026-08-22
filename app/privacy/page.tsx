import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PRIVACY_SECTIONS } from "./privacy-copy";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Privacy",
};

export default function PrivacyPage() {
  return (
    <PageShell variant="public" width="md">
      <section className="flex flex-col gap-3">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
          what we hold
        </p>
        <h1 className="font-heading text-4xl tracking-tight">
          Privacy<span className="text-seal">.</span>
        </h1>
        <a className="font-mono text-xs text-tint" href="/privacy.txt">
          plain text version
        </a>
      </section>
      <div className="flex flex-col gap-8 text-base text-muted-foreground">
        {PRIVACY_SECTIONS.map((section) => (
          <section key={section.heading} className="flex flex-col gap-3">
            <h2 className="font-heading text-xl tracking-tight text-foreground">
              {section.heading}
            </h2>
            {section.body.split("\n\n").map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
    </PageShell>
  );
}
