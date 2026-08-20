import { describe, it, expect } from "vitest";
import { createTestDb } from "./db.js";
import { envelopes } from "../db/schema.js";

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
});
