import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";

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
      </section>
      <div className="flex flex-col gap-8 text-base text-muted-foreground">
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-xl tracking-tight text-foreground">
            Send, sign, fetch
          </h2>
          <p>
            AgentSign is a signing primitive: send, sign, fetch. The software is
            licensed Apache-2.0. You bring the PDF. We do not write it, place
            fields on it, or claim it is good enough for any particular statute.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-xl tracking-tight text-foreground">
            Finish and Attest
          </h2>
          <p>
            A human finishes. Keys and agents never Finish for a person. Agents
            may Attest when you name them and allow them.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-xl tracking-tight text-foreground">
            Plans
          </h2>
          <p>
            Free keeps a completed file 7 days. Pro is $19 per month and keeps it
            a year. Login is identity, not a plan. We may refuse or cap abuse.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-xl tracking-tight text-foreground">
            Self-host
          </h2>
          <p>
            Self-host the same engine if you want it on your own machines. The
            cloud product is provided as-is.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
