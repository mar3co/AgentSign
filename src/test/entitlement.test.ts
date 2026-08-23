import { randomUUID } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { accounts, teamMembers, templates, templateRoles } from "../db/schema.js";
import { resetEnvCache } from "../env.js";
import { teamForUser } from "../lib/team.js";
import { isEntitled, TEAM_CAP, TEMPLATE_CAP, AGENT_CAP } from "../lib/entitlement.js";
import { createTestDb } from "./db.js";

afterEach(() => {
  delete process.env.SELF_HOST;
  resetEnvCache();
});

describe("isEntitled", () => {
  it("is false for free and true for pro", () => {
    expect(isEntitled({ plan: "free" })).toBe(false);
    expect(isEntitled({ plan: "pro" })).toBe(true);
    expect(isEntitled(null)).toBe(false);
  });

  it("is true for free accounts when SELF_HOST is set", () => {
    process.env.SELF_HOST = "1";
    resetEnvCache();
    expect(isEntitled({ plan: "free" })).toBe(true);
  });
});

describe("teamForUser", () => {
  it("solo user is their own team", async () => {
    const db = await createTestDb();
    const userId = randomUUID();
    await db.insert(accounts).values({
      userId,
      email: "shop@example.com",
      plan: "pro",
      displayName: "Shop Co",
    });
    const c = await teamForUser(db, userId);
    expect(c.ownerUserId).toBe(userId);
    expect(c.entitled).toBe(true);
    expect(c.displayName).toBe("Shop Co");
    expect(c.memberUserIds).toEqual([userId]);
  });

  it("active member uses the owner team", async () => {
    const db = await createTestDb();
    const ownerId = randomUUID();
    const memberId = randomUUID();
    await db.insert(accounts).values([
      { userId: ownerId, email: "owner@example.com", plan: "pro", displayName: "Acme" },
      { userId: memberId, email: "tech@example.com", plan: "free" },
    ]);
    await db.insert(teamMembers).values({
      ownerUserId: ownerId,
      email: "tech@example.com",
      userId: memberId,
      status: "active",
      tokenHash: "x".repeat(64),
      invitedAt: new Date(),
      acceptedAt: new Date(),
    });
    const c = await teamForUser(db, memberId);
    expect(c.ownerUserId).toBe(ownerId);
    expect(c.entitled).toBe(true);
    expect(c.displayName).toBe("Acme");
    expect(c.memberUserIds.sort()).toEqual([ownerId, memberId].sort());
  });
});

describe("caps", () => {
  it("exposes team 10 and templates 50", () => {
    expect(TEAM_CAP).toBe(10);
    expect(TEMPLATE_CAP).toBe(50);
    expect(AGENT_CAP).toBe(10);
  });
});
