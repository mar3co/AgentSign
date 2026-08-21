import { PageShell } from "@/components/page-shell";
import { PacketsClient } from "./packets-client";

export const runtime = "nodejs";

export default function PacketsPage() {
  return (
    <PageShell variant="app" width="lg">
      <PacketsClient />
    </PageShell>
  );
}
