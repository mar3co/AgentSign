import { PageShell } from "@/components/page-shell";
import { DashboardClient } from "./dashboard-client";

export const runtime = "nodejs";

export default function DashboardPage() {
  return (
    <PageShell variant="app" width="xl">
      <DashboardClient />
    </PageShell>
  );
}
