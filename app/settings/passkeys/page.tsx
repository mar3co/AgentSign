import { PageShell } from "@/components/page-shell";
import { PasskeysClient } from "./passkeys-client";

export const runtime = "nodejs";

export default function PasskeysSettingsPage() {
  return (
    <PageShell variant="app">
      <PasskeysClient />
    </PageShell>
  );
}
