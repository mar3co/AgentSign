import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Privacy",
};

export default function PrivacyPage() {
  return (
    <PageShell variant="public" width="md">
      <h1 className="font-heading text-4xl tracking-tight">Privacy</h1>
      <div className="flex flex-col gap-4 text-base text-muted-foreground">
        <p>
          You send us a PDF, a sender email, and signer names and emails. We
          store the file, hashes of signing tokens, and an audit log of send,
          consent, finish, attest, and shred.
        </p>
        <p>
          Free completed envelopes are shredded 7 days after they finish. If
          nobody signs, we shred when the link dies. Pro keeps them a year. Hard
          delete means the bytes go; the audit row stays as a tombstone.
        </p>
        <p>
          Signers do not need an account. Login is optional, after finish, if
          you want a cabinet. We do not sell your documents. We do not draft
          your legal language.
        </p>
        <p>
          Mail goes through our provider. Payments go through Stripe. Auth and
          storage sit on Supabase when you run the cloud product.
        </p>
      </div>
    </PageShell>
  );
}
