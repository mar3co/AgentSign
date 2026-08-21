import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { agents } from "../../../src/db/schema.js";
import { getDb } from "../../../src/db/client.js";
import { getAuth } from "../../../src/lib/auth/supabase.js";
import { cabinetForUser } from "../../../src/lib/cabinet.js";
import { getDeps } from "../../../src/lib/deps.js";
import { flagOn } from "../../../src/lib/flags.js";
import { mcpResource, resolveOauthClient } from "../../../src/lib/oauth.js";
import { safeNext } from "../../../src/lib/safeNext.js";
import { PageShell } from "@/components/page-shell";
import { AuthorizeForm } from "./authorize-form";

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
  let agentOptions: { id: string; slug: string; name: string }[] = [];
  const db = getDeps().db ?? getDb();
  if (clientId) {
    try {
      const resolved = await resolveOauthClient(db, clientId);
      if (!resolved.ok) error = resolved.error;
      else clientName = resolved.client.clientName;
    } catch {
      error = "Could not load client";
    }
  } else {
    error = "client_id required";
  }

  if (!error && (await flagOn("agent_parties"))) {
    const cabinet = await cabinetForUser(db, user.id);
    if (cabinet.entitled) {
      const rows = await db
        .select()
        .from(agents)
        .where(
          and(eq(agents.ownerUserId, cabinet.ownerUserId), isNull(agents.revokedAt)),
        );
      rows.sort((a, b) => a.slug.localeCompare(b.slug));
      agentOptions = rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
      }));
    }
  }

  return (
    <PageShell variant="app">
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <AuthorizeForm
          clientName={clientName}
          clientId={clientId}
          redirectUri={redirectUri}
          state={state}
          codeChallenge={codeChallenge}
          resource={resource}
          agents={agentOptions}
        />
      )}
    </PageShell>
  );
}
