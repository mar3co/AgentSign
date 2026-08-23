import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GET as getStats } from "../../app/v1/stats/route.js";
import { auditEvents, documents, signers } from "../db/schema.js";
import type { AuthAdapter, AuthUser } from "../lib/auth/supabase.js";
import { resetDeps, setDeps } from "../lib/deps.js";
import { createTestDb, type TestDb } from "./db.js";

const COOKIE = "sign_session=ok";
const DAY_MS = 86_400_000;

function authFor(user: AuthUser): AuthAdapter {
  return {
    async sendMagicLink() {},
    async signInWithPassword() {
      return { ok: false, error: "unused", code: "invalid_credentials" };
    },
    async signUp() {
      return { ok: true };
    },
    async startOAuth({ redirectTo }) {
      return { url: redirectTo };
    },
    async userFromCookie(header) {
      return header?.includes(COOKIE) ? user : null;
    },
    async exchangeCode() {
      return null;
    },
  };
}

async function seedDocument(
  db: TestDb,
  userId: string,
  input: { title: string; status: string; createdAt: Date; shredAt?: Date },
): Promise<string> {
  const [env] = await db
    .insert(documents)
    .values({
      userId,
      status: input.status as "pending",
      title: input.title,
      senderEmail: "shop@example.com",
      createdAt: input.createdAt,
      expiresAt: new Date(input.createdAt.getTime() + 7 * DAY_MS),
      shredAt: input.shredAt ?? new Date(Date.now() + 300 * DAY_MS),
    })
    .returning();
  return env!.id;
}

describe("GET /v1/stats", () => {
  afterEach(() => {
    resetDeps();
  });

  it("aggregates counts, the agent split, completion, and webhook health", async () => {
    const db = await createTestDb();
    const me: AuthUser = { id: randomUUID(), email: "shop@example.com" };
    setDeps({ db, auth: authFor(me) });

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS);

    // Completed, human-only, signed a day after sending.
    const done = await seedDocument(db, me.id, {
      title: "Signed deal",
      status: "completed",
      createdAt: twoDaysAgo,
    });
    await db.insert(signers).values({
      documentId: done,
      name: "Jane Porter",
      email: "jane@example.com",
      signingOrder: 1,
      kind: "human",
      signedAt: new Date(twoDaysAgo.getTime() + DAY_MS),
    });

    // Pending with an agent party, shredding soon.
    const withAgent = await seedDocument(db, me.id, {
      title: "Agent deal",
      status: "pending",
      createdAt: now,
      shredAt: new Date(now.getTime() + 2 * DAY_MS),
    });
    await db.insert(signers).values({
      documentId: withAgent,
      name: "ops-bot",
      email: "bot@example.com",
      signingOrder: 1,
      kind: "agent",
    });

    await db.insert(auditEvents).values([
      { documentId: done, event: "webhook_sent", createdAt: now },
      { documentId: done, event: "webhook_failed", createdAt: now },
      { documentId: done, event: "webhook_sent", createdAt: now },
    ]);

    // Someone else's document stays out of every number.
    await seedDocument(db, randomUUID(), {
      title: "Not mine",
      status: "pending",
      createdAt: now,
    });

    const res = await getStats(
      new Request("http://sign.test/v1/stats", { headers: { cookie: COOKIE } }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      total: number;
      by_status: Record<string, number>;
      sent: { agent_share: number };
      daily: Array<{ human: number; agent: number; completed: number }>;
      median_signing_hours: number | null;
      shredding_soon: number;
      webhooks_30d: { sent: number; failed: number };
    };
    expect(json.total).toBe(2);
    expect(json.by_status).toEqual({ completed: 1, pending: 1 });
    expect(json.sent.agent_share).toBeCloseTo(0.5);
    expect(json.median_signing_hours).toBeCloseTo(24, 0);
    expect(json.shredding_soon).toBe(1);
    expect(json.webhooks_30d).toEqual({ sent: 2, failed: 1 });
    const humanSends = json.daily.reduce((n, d) => n + d.human, 0);
    const agentSends = json.daily.reduce((n, d) => n + d.agent, 0);
    const completions = json.daily.reduce((n, d) => n + d.completed, 0);
    expect(humanSends).toBe(1);
    expect(agentSends).toBe(1);
    expect(completions).toBe(1);
  });

  it("rejects requests without a session", async () => {
    const db = await createTestDb();
    setDeps({
      db,
      auth: authFor({ id: randomUUID(), email: "shop@example.com" }),
    });
    const res = await getStats(new Request("http://sign.test/v1/stats"));
    expect(res.status).toBe(401);
  });
});
