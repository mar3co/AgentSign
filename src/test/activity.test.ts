import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GET as getActivity } from "../../app/v1/activity/route.js";
import { auditEvents, envelopes, signers } from "../db/schema.js";
import type { AuthAdapter, AuthUser } from "../lib/auth/supabase.js";
import { resetDeps, setDeps } from "../lib/deps.js";
import { createTestDb, type TestDb } from "./db.js";

const COOKIE = "sign_session=ok";

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

async function seedEnvelope(
  db: TestDb,
  userId: string,
  title: string,
): Promise<string> {
  const at = new Date();
  const [env] = await db
    .insert(envelopes)
    .values({
      userId,
      status: "pending",
      title,
      senderEmail: "shop@example.com",
      expiresAt: new Date(at.getTime() + 86_400_000),
      shredAt: new Date(at.getTime() + 7 * 86_400_000),
    })
    .returning();
  return env!.id;
}

describe("GET /v1/activity", () => {
  afterEach(() => {
    resetDeps();
  });

  it("returns notable events for the cabinet, newest first, plumbing filtered", async () => {
    const db = await createTestDb();
    const me: AuthUser = { id: randomUUID(), email: "shop@example.com" };
    setDeps({ db, auth: authFor(me) });

    const mine = await seedEnvelope(db, me.id, "Equipment rental agreement");
    const [jane] = await db
      .insert(signers)
      .values({
        envelopeId: mine,
        name: "Jane Porter",
        email: "jane@example.com",
        signingOrder: 1,
        kind: "human",
      })
      .returning();

    const t0 = new Date("2026-08-20T10:00:00Z");
    const t1 = new Date("2026-08-20T11:00:00Z");
    const t2 = new Date("2026-08-20T12:00:00Z");
    await db.insert(auditEvents).values([
      { envelopeId: mine, event: "sent", createdAt: t0 },
      // Plumbing: never surfaces in the feed.
      { envelopeId: mine, event: "otp_sent", createdAt: t1 },
      { envelopeId: mine, signerId: jane!.id, event: "signed", createdAt: t2 },
    ]);

    // Someone else's envelope must stay invisible.
    const theirs = await seedEnvelope(db, randomUUID(), "Not my envelope");
    await db
      .insert(auditEvents)
      .values({ envelopeId: theirs, event: "sent", createdAt: t2 });

    const res = await getActivity(
      new Request("http://sign.test/v1/activity", {
        headers: { cookie: COOKIE },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      events: Array<{
        event: string;
        title: string;
        actor: string | null;
        actor_kind: string | null;
      }>;
    };
    expect(json.events.map((e) => e.event)).toEqual(["signed", "sent"]);
    expect(json.events[0]).toMatchObject({
      title: "Equipment rental agreement",
      actor: "Jane Porter",
      actor_kind: "human",
    });
    expect(json.events[1]!.actor).toBeNull();
    expect(json.events.some((e) => e.title === "Not my envelope")).toBe(false);
  });

  it("rejects requests without a session cookie", async () => {
    const db = await createTestDb();
    setDeps({
      db,
      auth: authFor({ id: randomUUID(), email: "shop@example.com" }),
    });
    const anon = await getActivity(new Request("http://sign.test/v1/activity"));
    expect(anon.status).toBe(401);
    const wrong = await getActivity(
      new Request("http://sign.test/v1/activity", {
        headers: { cookie: "sign_session=nope" },
      }),
    );
    expect(wrong.status).toBe(401);
  });
});
