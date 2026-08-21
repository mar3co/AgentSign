import { PageShell } from "@/components/page-shell";
import { TeamClient } from "./team-client";

export const runtime = "nodejs";

export default function TeamPage() {
  return (
    <PageShell variant="app" width="lg">
      <TeamClient />
    </PageShell>
  );
}
