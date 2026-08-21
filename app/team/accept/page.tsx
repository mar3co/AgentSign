import { cookies } from "next/headers";
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
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <p className="text-base font-medium">Sign</p>
        <a className="text-sm text-muted-foreground underline" href="/envelopes">
          Cabinet
        </a>
      </header>
      <main className="flex flex-1 flex-col">
        <TeamAccept
          token={token}
          email={sp.email ?? ""}
          needsLogin={!user}
        />
      </main>
      <footer className="pb-4 text-center text-sm text-muted-foreground">
        Sign
      </footer>
    </div>
  );
}
