import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Terms",
};

export default function TermsPage() {
  return (
    <PageShell variant="public" width="md">
      <h1 className="font-heading text-4xl tracking-tight">Terms</h1>
      <div className="flex flex-col gap-4 text-base text-muted-foreground">
        <p>
          AgentSign is a signing primitive: send, sign, fetch. The software is
          licensed Apache-2.0. You bring the PDF. We do not write it, place
          fields on it, or claim it is good enough for any particular statute.
        </p>
        <p>
          A human finishes. Keys and agents never Finish for a person. Agents
          may Attest when you name them and allow them.
        </p>
        <p>
          Free keeps a completed file 7 days. Pro is $19 per month and keeps it
          a year. Login is identity, not a plan. We may refuse or cap abuse.
        </p>
        <p>
          Self-host the same engine if you want it on your own machines. The
          cloud product is provided as-is.
        </p>
      </div>
    </PageShell>
  );
}
