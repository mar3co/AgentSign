import { PageShell } from "@/components/page-shell";
import { SettingsShell } from "@/components/settings-shell";
import { PasskeysClient } from "../passkeys/passkeys-client";

export const runtime = "nodejs";

export default function SecuritySettingsPage() {
  return (
    <PageShell variant="app" width="xl">
      <SettingsShell current="security">
        <PasskeysClient />
      </SettingsShell>
    </PageShell>
  );
}
