import { describe, it, expect } from "vitest";
import { createTestDb } from "./db.js";
import { envelopes, accounts, packets, packetRoles } from "../db/schema.js";

describe("schema", () => {
  it("inserts an envelope", async () => {
    const db = await createTestDb();
    const [row] = await db
      .insert(envelopes)
      .values({
        title: "Repair authorization",
        senderEmail: "shop@example.com",
        status: "pending_sender",
        expiresAt: new Date(Date.now() + 72 * 3600_000),
        shredAt: new Date(Date.now() + 7 * 86400_000),
      })
      .returning();
    expect(row.id).toBeTruthy();
    expect(row.status).toBe("pending_sender");
  });

  it("inserts a packet with a role", async () => {
    const db = await createTestDb();
    const userId = crypto.randomUUID();
    await db.insert(accounts).values({ userId, email: "a@b.c", plan: "pro" });
    const [p] = await db.insert(packets).values({
      ownerUserId: userId,
      createdByUserId: userId,
      title: "Repair packet",
      storagePath: "packets/x/original.pdf",
    }).returning();
    await db.insert(packetRoles).values({
      packetId: p.id,
      signingOrder: 1,
      roleName: "Customer",
    });
    expect(p.title).toBe("Repair packet");
  });
});
