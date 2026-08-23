import { getDb } from "../db/client.js";
import { getAuth } from "./auth/supabase.js";
import { cabinetForUser } from "./cabinet.js";
import { getDeps } from "./deps.js";

/**
 * Server-side entitlement for portal pages, so gated pages (Packets, Agents,
 * Branding) can render the upgrade gate without a client probe that ends in
 * a 403. Returns null when there is no session — the client keeps its
 * fetch-then-redirect behavior for that case.
 */
export async function entitledForCookie(
  cookieHeader: string | null,
): Promise<boolean | null> {
  if (!cookieHeader) return null;
  try {
    const user = await getAuth().userFromCookie(cookieHeader);
    if (!user) return null;
    const db = getDeps().db ?? getDb();
    const cabinet = await cabinetForUser(db, user.id);
    return cabinet.entitled;
  } catch {
    // Auth or DB hiccups fall back to the client probe rather than a 500.
    return null;
  }
}
