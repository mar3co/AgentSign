import type { AuditDb } from "./audit.js";
import { teamForUser } from "./team.js";

export function publicSignUrl(token: string, host?: string | null): string {
  const path = `/s/${token}`;
  if (host) return `https://${host}${path}`;
  return path;
}

export function verifiedSigningHost(team: {
  customDomain: string | null;
  customDomainVerifiedAt: Date | null;
}): string | null {
  if (!team.customDomain || !team.customDomainVerifiedAt) return null;
  return team.customDomain;
}

export async function loadSigningHost(
  db: AuditDb,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  const team = await teamForUser(db, userId);
  return verifiedSigningHost(team);
}
