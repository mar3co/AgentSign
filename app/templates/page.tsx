import { PageShell } from "@/components/page-shell";
import { TemplatesClient } from "./templates-client";

export const runtime = "nodejs";

export default function TemplatesPage() {
  return (
    <PageShell variant="app" width="lg">
      <TemplatesClient />
    </PageShell>
  );
}
