import { and, eq } from "drizzle-orm";
import { accounts, cabinetMembers } from "../db/schema.js";
import type { AuditDb } from "./audit.js";
import { isEntitled } from "./entitlement.js";

export type CabinetMemberRow = {
  id: string;
  email: string;
  userId: string | null;
  status: "invited" | "active";
};

export type Cabinet = {
  ownerUserId: string;
  ownerEmail: string | null;
  entitled: boolean;
  displayName: string | null;
  logoPath: string | null;
  members: CabinetMemberRow[];
  memberUserIds: string[];
};

export async function cabinetForUser(
  db: AuditDb,
  userId: string,
): Promise<Cabinet> {
  const [membership] = await db
    .select()
    .from(cabinetMembers)
    .where(
      and(eq(cabinetMembers.userId, userId), eq(cabinetMembers.status, "active")),
    );
  const ownerUserId = membership?.ownerUserId ?? userId;

  const [ownerAccount] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, ownerUserId));

  const members = await db
    .select()
    .from(cabinetMembers)
    .where(eq(cabinetMembers.ownerUserId, ownerUserId));

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
    members: members.map((m) => ({
      id: m.id,
      email: m.email,
      userId: m.userId,
      status: m.status,
    })),
    memberUserIds,
  };
}
