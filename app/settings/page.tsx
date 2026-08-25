import { PageShell } from "@/components/page-shell";
import { SettingsShell } from "@/components/settings-shell";
import { AccountClient } from "./account-client";

export const runtime = "nodejs";

export default function SettingsPage() {
  return (
    <PageShell variant="app" width="xl">
      <SettingsShell current="account">
        <AccountClient />
      </SettingsShell>
    </PageShell>
  );
}
