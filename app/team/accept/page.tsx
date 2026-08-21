import { cookies } from "next/headers";
import { PageShell } from "@/components/page-shell";
import { getAuth } from "../../../src/lib/auth/supabase.js";
import { TeamAccept } from "./team-accept";

export const runtime = "nodejs";

export default async function TeamAcceptPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string; email?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const token = sp.token ?? "";
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const user = await getAuth().userFromCookie(header || null);

  return (
    <PageShell variant={user ? "app" : "auth"}>
      <TeamAccept
        token={token}
        email={sp.email ?? ""}
        needsLogin={!user}
      />
    </PageShell>
  );
}
