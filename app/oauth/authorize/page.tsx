import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "../../../src/lib/auth/supabase.js";
import { mcpResource, resolveOauthClient } from "../../../src/lib/oauth.js";
import { getDeps } from "../../../src/lib/deps.js";
import { getDb } from "../../../src/db/client.js";
import { safeNext } from "../../../src/lib/safeNext.js";

export const runtime = "nodejs";

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const clientId = first(sp.client_id);
  const redirectUri = first(sp.redirect_uri);
  const state = first(sp.state);
  const codeChallenge = first(sp.code_challenge);
  const resource = first(sp.resource) || mcpResource();

  const q = new URLSearchParams();
  if (clientId) q.set("client_id", clientId);
  if (redirectUri) q.set("redirect_uri", redirectUri);
  if (state) q.set("state", state);
  if (codeChallenge) q.set("code_challenge", codeChallenge);
  if (resource) q.set("resource", resource);
  const next = `/oauth/authorize${q.size ? `?${q.toString()}` : ""}`;

  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const user = await getAuth().userFromCookie(header || null);
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(safeNext(next))}`);
  }

  let clientName = "this client";
  let error: string | null = null;
  if (clientId) {
    try {
      const db = getDeps().db ?? getDb();
      const resolved = await resolveOauthClient(db, clientId);
      if (!resolved.ok) error = resolved.error;
      else clientName = resolved.client.clientName;
    } catch {
      error = "Could not load client";
    }
  } else {
    error = "client_id required";
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <p className="text-base font-medium">Sign</p>
        <a className="text-sm text-muted-foreground underline" href="/">
          Home
        </a>
      </header>
      <main className="flex flex-1 flex-col gap-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <>
            <p className="text-base">
              {clientName} wants to use your AgentSign account.
            </p>
            <p className="text-sm text-muted-foreground">
              Send, status, and download. Attest only for agents you allow.
            </p>
            <form method="post" action="/oauth/authorize" className="flex flex-col gap-3">
              <input type="hidden" name="client_id" value={clientId} />
              <input type="hidden" name="redirect_uri" value={redirectUri} />
              <input type="hidden" name="state" value={state} />
              <input type="hidden" name="code_challenge" value={codeChallenge} />
              <input type="hidden" name="resource" value={resource} />
              <button
                type="submit"
                className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground"
              >
                Allow
              </button>
            </form>
          </>
        )}
      </main>
      <footer className="pb-4 text-center text-sm text-muted-foreground">
        Sign
      </footer>
    </div>
  );
}
