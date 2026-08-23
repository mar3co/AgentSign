import { PageShell } from "@/components/page-shell";
import { SendClient } from "./send-client";

export const runtime = "nodejs";

export default function SendPage() {
  return (
    <PageShell variant="app" width="lg">
      <SendClient />
    </PageShell>
  );
}
