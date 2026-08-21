import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";

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
        <h1 className="font-heading text-4xl tracking-tight">Privacy</h1>
      </section>
      <div className="flex flex-col gap-8 text-base text-muted-foreground">
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-xl tracking-tight text-foreground">
            What we keep
          </h2>
          <p>
            You send us a PDF, a sender email, and signer names and emails. We
            store the file, hashes of signing tokens, and an audit log of send,
            consent, finish, attest, and shred.
          </p>
          <p>
            Mail goes through our provider. Payments go through Stripe. Auth and
            storage sit on Supabase when you run the cloud product.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-xl tracking-tight text-foreground">
            What we shred
          </h2>
          <p>
            Free completed envelopes are shredded 7 days after they finish. If
            nobody signs, we shred when the link dies. Pro keeps them a year.
            Hard delete means the bytes go; the audit row stays as a tombstone.
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-xl tracking-tight text-foreground">
            What we don&apos;t do
          </h2>
          <p>
            Signers do not need an account. Login is optional, after finish, if
            you want a cabinet. We do not sell your documents. We do not draft
            your legal language.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
