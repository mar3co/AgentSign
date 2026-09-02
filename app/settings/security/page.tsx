import { PageShell } from "@/components/page-shell";
import { SettingsShell } from "@/components/settings-shell";
import { PasskeysClient } from "../passkeys/passkeys-client";
import { ConnectedAppsClient } from "./connected-apps-client";
import { SendingClient } from "./sending-client";

export const runtime = "nodejs";

export default function SecuritySettingsPage() {
  return (
    <PageShell variant="app" width="xl">
      <SettingsShell current="security">
        <PasskeysClient />
        <ConnectedAppsClient />
        <SendingClient />
      </SettingsShell>
    </PageShell>
  );
}
