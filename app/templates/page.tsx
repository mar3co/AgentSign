import { cookies } from "next/headers";
import { PageShell } from "@/components/page-shell";
import { entitledForCookie } from "../../src/lib/portal.js";
import { TemplatesClient } from "./templates-client";

export const runtime = "nodejs";

export default async function TemplatesPage() {
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const entitled = await entitledForCookie(header || null);
  return (
    <PageShell variant="app" width="lg">
      <TemplatesClient initialEntitled={entitled} />
    </PageShell>
  );
}
