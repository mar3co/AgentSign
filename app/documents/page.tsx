import { PageShell } from "@/components/page-shell";
import { DocumentsClient } from "./documents-client";

export const runtime = "nodejs";

export default function DocumentsPage() {
  return (
    <PageShell variant="app" width="xl">
      <DocumentsClient />
    </PageShell>
  );
}
