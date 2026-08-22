import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { TERMS_SECTIONS } from "./terms-copy";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Terms",
};

export default function TermsPage() {
  return (
    <PageShell variant="public" width="md">
      <section className="flex flex-col gap-3">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
          the product
        </p>
        <h1 className="font-heading text-4xl tracking-tight">Terms</h1>
        <a className="font-mono text-xs text-tint" href="/terms.txt">
          plain text version
        </a>
      </section>
      <div className="flex flex-col gap-8 text-base text-muted-foreground">
        {TERMS_SECTIONS.map((section) => (
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
