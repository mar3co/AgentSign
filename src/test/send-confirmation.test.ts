import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST as postDocument } from "../../app/v1/documents/route.js";
import { POST as postOtp } from "../../app/v1/documents/[id]/otp/route.js";
import { GET as getSending, PATCH as patchSending } from "../../app/v1/sending/route.js";
import { accounts, apiKeys, documents, oauthGrants } from "../db/schema.js";
import { resetDeps, setDeps } from "../lib/deps.js";
import { createFsStore } from "../lib/storage.js";
import { newLiveKey, newOauthToken } from "../lib/tokens.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

type Sent = { to: string; subject: string; text: string };

async function boot() {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const sent: Sent[] = [];
  setDeps({
    db,
    store,
    mailer: {
      sendMail: async (m) => {
        sent.push(m);
      },
    },
  });
  return { db, sent };
}

async function accountWith(
  db: Awaited<ReturnType<typeof createTestDb>>,
  overrides: Partial<typeof accounts.$inferInsert> = {},
) {
  const userId = randomUUID();
  await db
    .insert(accounts)
    .values({ userId, email: "shop@example.com", ...overrides });
  return userId;
}

async function oauthBearer(
  db: Awaited<ReturnType<typeof createTestDb>>,
  userId: string,
) {
  const token = newOauthToken();
  await db.insert(oauthGrants).values({
    userId,
    clientId: "client_test",
    accessHash: token.hash,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return `Bearer ${token.raw}`;
}

async function postSend(headers: Record<string, string>) {
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", "Repair authorization");
  body.set("sender_email", "shop@example.com");
  body.set(
    "signers",
    JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
  );
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  return postDocument(
    new Request("http://sign.test/v1/documents", {
      method: "POST",
      headers,
      body,
    }),
  );
}

function confirmCode(id: string, code: string) {
  return postOtp(
    new Request(`http://sign.test/v1/documents/${id}/otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("send confirmation", () => {
  afterEach(() => {
    resetDeps();
  });

  it("holds an OAuth agent send for the emailed code by default", async () => {
    const { db, sent } = await boot();
    const userId = await accountWith(db);
    const auth = await oauthBearer(db, userId);

    const res = await postSend({ authorization: auth });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string; status: string };
    expect(json.status).toBe("pending_sender");
    expect(sent.some((m) => /verification code/i.test(m.subject))).toBe(true);
    expect(sent.some((m) => m.to === "jane@example.com")).toBe(false);

    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const confirmed = await confirmCode(json.id, code);
    expect(confirmed.status).toBe(200);
    const done = (await confirmed.json()) as {
      status: string;
      key: string;
      signers: { email: string }[];
    };
    expect(done.status).toBe("pending");
    expect(done.key).toMatch(/^sign_tmp_/);
    expect(sent.some((m) => m.to === "jane@example.com")).toBe(true);
  });

  it("sends directly when the agent confirmation is turned off", async () => {
    const { db, sent } = await boot();
    const userId = await accountWith(db, { confirmAgentSends: false });
    const auth = await oauthBearer(db, userId);

    const res = await postSend({ authorization: auth });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("pending");
    expect(sent.some((m) => /verification code/i.test(m.subject))).toBe(false);
    expect(sent.some((m) => m.to === "jane@example.com")).toBe(true);
  });

  it("live API keys keep sending immediately with confirmation on", async () => {
    const { db, sent } = await boot();
    const userId = await accountWith(db); // confirm_agent_sends defaults on
    const live = newLiveKey();
    await db.insert(apiKeys).values({
      kind: "live",
      prefix: live.prefix,
      tokenHash: live.hash,
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const res = await postSend({ authorization: `Bearer ${live.raw}` });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("pending");
    expect(sent.some((m) => /verification code/i.test(m.subject))).toBe(false);
  });

  it("an entitled sender is not free-capped when confirming a held send", async () => {
    const { db, sent } = await boot();
    const userId = await accountWith(db, { plan: "pro" });
    const auth = await oauthBearer(db, userId);
    const at = new Date();
    const later = new Date(at.getTime() + 86_400_000);
    for (let i = 0; i < 25; i++) {
      await db.insert(documents).values({
        title: `Old ${i}`,
        senderEmail: "shop@example.com",
        userId,
        status: "pending",
        expiresAt: later,
        shredAt: later,
        createdAt: at,
      });
    }

    const res = await postSend({ authorization: auth });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { id: string; status: string };
    expect(json.status).toBe("pending_sender");
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const confirmed = await confirmCode(json.id, code);
    expect(confirmed.status).toBe(200);
  });

  it("sending settings read and update through a session only", async () => {
    const { db } = await boot();
    const user = { id: randomUUID(), email: "shop@example.com" };
    setDeps({
      auth: {
        userFromCookie: async (header: string | null) =>
          header?.includes("sign_session=tok") ? user : null,
      } as never,
    });

    const unauthed = await getSending(
      new Request("http://sign.test/v1/sending"),
    );
    expect(unauthed.status).toBe(401);

    const cookie = { cookie: "sign_session=tok" };
    const initial = await getSending(
      new Request("http://sign.test/v1/sending", { headers: cookie }),
    );
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({
      confirm_agent_sends: true,
      confirm_human_sends: false,
    });

    const patched = await patchSending(
      new Request("http://sign.test/v1/sending", {
        method: "PATCH",
        headers: { ...cookie, "content-type": "application/json" },
        body: JSON.stringify({
          confirm_agent_sends: false,
          confirm_human_sends: true,
        }),
      }),
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({
      confirm_agent_sends: false,
      confirm_human_sends: true,
    });
    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, user.id));
    expect(row!.confirmAgentSends).toBe(false);
    expect(row!.confirmHumanSends).toBe(true);
  });

  it("an agent cannot change its own confirmation gate", async () => {
    const { db } = await boot();
    const userId = await accountWith(db);
    const auth = await oauthBearer(db, userId);
    const res = await patchSending(
      new Request("http://sign.test/v1/sending", {
        method: "PATCH",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ confirm_agent_sends: false }),
      }),
    );
    expect(res.status).toBe(403);
    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, userId));
    expect(row!.confirmAgentSends).toBe(true);
  });
});
