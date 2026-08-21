import { PageShell } from "@/components/page-shell";
import { AgentsClient } from "./agents-client";

export const runtime = "nodejs";

export default function AgentsPage() {
  return (
    <PageShell variant="app" width="lg">
      <AgentsClient />
    </PageShell>
  );
}
