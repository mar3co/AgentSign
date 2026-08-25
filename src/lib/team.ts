import { and, eq } from "drizzle-orm";
import { accounts, teamMembers } from "../db/schema.js";
import type { AuditDb } from "./audit.js";
import { isEntitled } from "./entitlement.js";

export type TeamMemberRow = {
  id: string;
  email: string;
  userId: string | null;
  status: "invited" | "active";
};

export type Team = {
  ownerUserId: string;
  ownerEmail: string | null;
  entitled: boolean;
  displayName: string | null;
  logoPath: string | null;
  timezone: string | null;
  description: string | null;
  members: TeamMemberRow[];
  memberUserIds: string[];
};

export async function teamForUser(
  db: AuditDb,
  userId: string,
): Promise<Team> {
  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(
      and(eq(teamMembers.userId, userId), eq(teamMembers.status, "active")),
    );
  const ownerUserId = membership?.ownerUserId ?? userId;

  const [ownerAccount] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, ownerUserId));

  const members = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.ownerUserId, ownerUserId));

  const memberUserIds = [
    ownerUserId,
    ...members
      .filter((m) => m.status === "active" && m.userId)
      .map((m) => m.userId as string),
  ];

  return {
    ownerUserId,
    ownerEmail: ownerAccount?.email ?? null,
    entitled: isEntitled(ownerAccount),
    displayName: ownerAccount?.displayName ?? null,
    logoPath: ownerAccount?.logoPath ?? null,
    timezone: ownerAccount?.timezone ?? null,
    description: ownerAccount?.description ?? null,
    members: members.map((m) => ({
      id: m.id,
      email: m.email,
      userId: m.userId,
      status: m.status,
    })),
    memberUserIds,
  };
}
