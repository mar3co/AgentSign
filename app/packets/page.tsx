import { cookies } from "next/headers";
import { PageShell } from "@/components/page-shell";
import { entitledForCookie } from "../../src/lib/portal.js";
import { PacketsClient } from "./packets-client";

export const runtime = "nodejs";

export default async function PacketsPage() {
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const entitled = await entitledForCookie(header || null);
  return (
    <PageShell variant="app" width="lg">
      <PacketsClient initialEntitled={entitled} />
    </PageShell>
  );
}
