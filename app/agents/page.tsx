import { cookies } from "next/headers";
import { PageShell } from "@/components/page-shell";
import { entitledForCookie } from "../../src/lib/portal.js";
import { AgentsClient } from "./agents-client";

export const runtime = "nodejs";

export default async function AgentsPage() {
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const entitled = await entitledForCookie(header || null);
  return (
    <PageShell variant="app" width="lg">
      <AgentsClient initialEntitled={entitled} />
    </PageShell>
  );
}
