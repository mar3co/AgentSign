import { PageShell } from "@/components/page-shell";
import { CabinetClient } from "./cabinet-client";

export const runtime = "nodejs";

export default function EnvelopesPage() {
  return (
    <PageShell variant="app" width="xl">
      <CabinetClient />
    </PageShell>
  );
}
