import { PageShell } from "@/components/page-shell";
import { SettingsShell } from "@/components/settings-shell";
import { WorkspaceClient } from "./workspace-client";

export const runtime = "nodejs";

export default function WorkspaceSettingsPage() {
  return (
    <PageShell variant="app" width="xl">
      <SettingsShell current="workspace">
        <WorkspaceClient />
      </SettingsShell>
    </PageShell>
  );
}
