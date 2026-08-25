import { PageShell } from "@/components/page-shell";
import { SettingsShell } from "@/components/settings-shell";
import { BillingClient } from "./billing-client";

export const runtime = "nodejs";

export default function BillingSettingsPage() {
  return (
    <PageShell variant="app" width="xl">
      <SettingsShell current="billing">
        <BillingClient />
      </SettingsShell>
    </PageShell>
  );
}
