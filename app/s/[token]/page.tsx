import { PageShell } from "@/components/page-shell";
import { CONSENT_TEXT, getSigningState } from "../../../src/routes/signing.js";
import { SigningCeremony } from "./signing-ceremony";

export const runtime = "nodejs";

export default async function SigningPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await getSigningState(token);
  if (res.status === 404) {
    return (
      <PageShell variant="ceremony" showRange={false}>
        <p className="text-base">Not found</p>
      </PageShell>
    );
  }
  if (res.status === 410) {
    return (
      <PageShell variant="ceremony" showRange={false}>
        <p className="text-base">This link has expired.</p>
      </PageShell>
    );
  }
  if (res.status === 409) {
    const body = (await res.json()) as { error?: string };
    return (
      <PageShell variant="ceremony" showRange={false}>
        <p className="text-base">{body.error ?? "Waiting on previous signer."}</p>
      </PageShell>
    );
  }
  if (!res.ok) {
    return (
      <PageShell variant="ceremony" showRange={false}>
        <p className="text-base">Unable to load this document.</p>
      </PageShell>
    );
  }
  const state = (await res.json()) as {
    title: string;
    signerName: string;
    signerEmail?: string;
    sequentialWait: boolean;
    expiresAt: string;
    shredAt?: string;
    signed?: boolean;
    declined?: boolean;
    status?: string;
    display_name?: string | null;
    has_logo?: boolean;
    attested?: { slug: string; email: string }[];
  };
  return (
    <PageShell variant="ceremony" showRange={false} width="md">
      <SigningCeremony token={token} state={state} consentText={CONSENT_TEXT} />
    </PageShell>
  );
}
