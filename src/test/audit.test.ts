import { describe, it, expect } from "vitest";
import { createTestDb } from "./db.js";
import { envelopes, auditEvents } from "../db/schema.js";
import { logEvent } from "../lib/audit.js";
import { eq } from "drizzle-orm";

describe("audit", () => {
  it("appends events and strips secrets from payload", async () => {
    const db = await createTestDb();
    const [env] = await db.insert(envelopes).values({
      title: "t",
      senderEmail: "a@b.c",
      status: "pending",
      expiresAt: new Date(),
      shredAt: new Date(),
    }).returning();
    await logEvent(db, {
      envelopeId: env.id,
      event: "sent",
      payload: { token: "SECRET", ok: true },
    });
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.envelopeId, env.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ ok: true });
  });
});
