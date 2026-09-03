import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { POST as postAccept } from "../../app/internal/team/accept/route.js";
import { GET as listDocuments, POST as postDocument } from "../../app/v1/documents/route.js";
import {
  DELETE as deleteDocument,
  GET as getDocument,
} from "../../app/v1/documents/[id]/route.js";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import { GET as getTeam } from "../../app/v1/team/route.js";
import { POST as postInvite } from "../../app/v1/team/invites/route.js";
import { DELETE as deleteMember } from "../../app/v1/team/members/[id]/route.js";
import { accounts, teamMembers, documents, signers } from "../db/schema.js";
import { setDeps } from "../lib/deps.js";
import { extendKeep } from "../lib/keys.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { createFsStore } from "../lib/storage.js";
import { teamSeatCount } from "../routes/team.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

type AuthUser = { id: string; email: string };

type TeamMember = {
  id: string;
  email: string;
  status: "invited" | "active";
  role: "owner" | "member";
};

type TeamJson = {
  owner_email: string | null;
  members: TeamMember[];
  entitled: boolean;
};

function createFakeAuth() {
  const users = new Map<string, AuthUser>();
  const sessions = new Map<string, AuthUser>();
  const codes = new Map<string, AuthUser>();

  function userFor(email: string): AuthUser {
    const e = email.toLowerCase();
    let u = users.get(e);
    if (!u) {
      u = { id: randomUUID(), email: e };
      users.set(e, u);
    }
    return u;
  }

  return {
    userFor,
    adapter: {
      async sendMagicLink({ email }: { email: string }) {
        const u = userFor(email);
        codes.set(`magic:${u.email}`, u);
      },
      async signInWithPassword() {
        return {
          ok: false as const,
          error: "Invalid credentials",
          code: "invalid_credentials",
        };
      },
      async signUp() {
        return { ok: true as const };
      },
      async startOAuth({
        redirectTo,
      }: {
        provider: "google" | "github";
        redirectTo: string;
      }) {
        return { url: redirectTo };
      },
      async userFromCookie(header: string | null) {
        if (!header) return null;
        const m = header.match(/(?:^|;\s*)sign_session=([^;]+)/);
        if (!m) return null;
        return sessions.get(m[1]!) ?? null;
      },
      async exchangeCode(code: string) {
        const u = codes.get(code);
        if (!u) return null;
        const token = randomUUID();
        sessions.set(token, u);
        return {
          user: u,
          cookie: `sign_session=${token}; Path=/; HttpOnly`,
        };
      },
    },
  };
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

async function magicCookie(email: string) {
  const login = await postLogin(
    new Request("http://sign.test/login/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  expect(login.status).toBe(200);
  const cb = await getAuthCallback(
    new Request(
      `http://sign.test/auth/callback?code=${encodeURIComponent(`magic:${email.toLowerCase()}`)}`,
    ),
  );
  expect(cb.status).toBe(302);
  return cookieFrom(cb);
}

async function boot() {
  const db = await createTestDb();
  const { adapter, userFor } = createFakeAuth();
  const sent: { to: string; subject: string; text: string }[] = [];
  setDeps({
    db,
    auth: adapter,
    mailer: {
      sendMail: async (m) => {
        sent.push(m);
      },
    },
  });
  return { db, userFor, sent };
}

async function asPro(
  db: Awaited<ReturnType<typeof createTestDb>>,
  userFor: (email: string) => AuthUser,
  email = "shop@example.com",
) {
  const cookie = await magicCookie(email);
  const userId = userFor(email).id;
  await db
    .update(accounts)
    .set({ plan: "pro" })
    .where(eq(accounts.userId, userId));
  return { cookie, userId };
}

function memberCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function inviteReq(cookie: string, email: string) {
  return new Request("http://sign.test/v1/team/invites", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

function acceptReq(cookie: string, token: string) {
  return new Request("http://sign.test/team/accept", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

function tokenFromMail(text: string): string {
  const m = text.match(/\/team\/accept\?token=([A-Za-z0-9_-]+)/);
  expect(m?.[1]).toBeTruthy();
  return m![1]!;
}

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function bootStore(now?: () => Date) {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const { adapter, userFor } = createFakeAuth();
  const sent: { to: string; subject: string; text: string }[] = [];
  setDeps({
    db,
    store,
    auth: adapter,
    mailer: {
      sendMail: async (m) => {
        sent.push(m);
      },
    },
    now: now ?? (() => new Date()),
    p12: makeDevP12("test"),
    p12Passphrase: "test",
  });
  return { db, userFor, sent };
}

async function mintLive(cookie: string) {
  const minted = await postKeys(
    new Request("http://sign.test/v1/keys", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    }),
  );
  expect(minted.status).toBe(201);
  const { key } = (await minted.json()) as { key: string };
  return key;
}

async function sendLive(key: string, title: string) {
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", title);
  body.set("sender_email", "ignored@example.com");
  body.set(
    "signers",
    JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
  );
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  const res = await postDocument(
    new Request("http://sign.test/v1/documents", {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body,
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; status: string };
}

async function listFor(headers: HeadersInit) {
  const res = await listDocuments(
    new Request("http://sign.test/v1/documents", { headers }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    documents: { id: string; can_delete: boolean; status: string }[];
  };
}

async function proTeam(
  ownerEmail = "shop@example.com",
  memberEmail = "tech@example.com",
  now?: () => Date,
) {
  const ctx = await bootStore(now);
  const { cookie: ownerCookie, userId: ownerUserId } = await asPro(
    ctx.db,
    ctx.userFor,
    ownerEmail,
  );
  expect((await postInvite(inviteReq(ownerCookie, memberEmail))).status).toBe(
    201,
  );
  const token = tokenFromMail(ctx.sent[0]!.text);
  const memberCookie = await magicCookie(memberEmail);
  expect((await postAccept(acceptReq(memberCookie, token))).status).toBe(200);
  return {
    ...ctx,
    ownerCookie,
    memberCookie,
    ownerUserId,
    memberUserId: ctx.userFor(memberEmail).id,
    ownerKey: await mintLive(ownerCookie),
    memberKey: await mintLive(memberCookie),
    ownerEmail,
    memberEmail,
  };
}

async function twoSends(now?: () => Date) {
  const team = await proTeam("shop@example.com", "tech@example.com", now);
  const a = await sendLive(team.ownerKey, "Document A");
  const b = await sendLive(team.memberKey, "Document B");
  return { team, a, b };
}

async function seedSends(
  db: Awaited<ReturnType<typeof createTestDb>>,
  userId: string,
  email: string,
  n: number,
  at: Date,
) {
  for (let i = 0; i < n; i++) {
    await db.insert(documents).values({
      title: `Seed ${i}`,
      senderEmail: email,
      userId,
      status: "pending",
      expiresAt: at,
      shredAt: at,
      createdAt: at,
    });
  }
}

describe("team API", () => {
  it("free owner POST invite is 403 pro_required", async () => {
    await boot();
    const cookie = await magicCookie("shop@example.com");
    const res = await postInvite(inviteReq(cookie, "tech@example.com"));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("pro_required");
  });

  it("pro owner invite 201, mail has accept URL, GET lists owner + invited", async () => {
    const { db, userFor, sent } = await boot();
    const { cookie } = await asPro(db, userFor);
    const res = await postInvite(inviteReq(cookie, "tech@example.com"));
    expect(res.status).toBe(201);
    const invited = (await res.json()) as {
      id: string;
      email: string;
      status: string;
    };
    expect(invited.id).toBeTruthy();
    expect(invited.email).toBe("tech@example.com");
    expect(invited.status).toBe("invited");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("tech@example.com");
    expect(sent[0]!.subject).toBe("Join your team on OpenSeal");
    expect(sent[0]!.text).toContain("/team/accept?token=");
    tokenFromMail(sent[0]!.text);

    const listed = await getTeam(
      new Request("http://sign.test/v1/team", { headers: { cookie } }),
    );
    expect(listed.status).toBe(200);
    const team = (await listed.json()) as TeamJson;
    expect(team.owner_email).toBe("shop@example.com");
    expect(team.entitled).toBe(true);
    expect(team.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "shop@example.com",
          role: "owner",
          status: "active",
        }),
        expect.objectContaining({
          id: invited.id,
          email: "tech@example.com",
          role: "member",
          status: "invited",
        }),
      ]),
    );
  });

  it("accept as invitee then GET as member lists both active", async () => {
    const { db, userFor, sent } = await boot();
    const { cookie } = await asPro(db, userFor);
    const invited = await postInvite(inviteReq(cookie, "tech@example.com"));
    expect(invited.status).toBe(201);
    const token = tokenFromMail(sent[0]!.text);
    const memberCookie = await magicCookie("tech@example.com");
    const accepted = await postAccept(acceptReq(memberCookie, token));
    expect(accepted.status).toBe(200);

    const listed = await getTeam(
      new Request("http://sign.test/v1/team", { headers: { cookie: memberCookie } }),
    );
    expect(listed.status).toBe(200);
    const team = (await listed.json()) as TeamJson;
    expect(team.owner_email).toBe("shop@example.com");
    expect(team.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: "shop@example.com",
          role: "owner",
          status: "active",
        }),
        expect.objectContaining({
          email: "tech@example.com",
          role: "member",
          status: "active",
        }),
      ]),
    );
    expect(team.members.filter((m) => m.status === "active")).toHaveLength(2);
  });

  it("accept as different email is 403", async () => {
    const { db, userFor, sent } = await boot();
    const { cookie } = await asPro(db, userFor);
    expect((await postInvite(inviteReq(cookie, "tech@example.com"))).status).toBe(
      201,
    );
    const token = tokenFromMail(sent[0]!.text);
    const otherCookie = await magicCookie("other@example.com");
    const res = await postAccept(acceptReq(otherCookie, token));
    expect(res.status).toBe(403);
  });

  it("second invite of active email is 409 already_member", async () => {
    const { db, userFor, sent } = await boot();
    const { cookie } = await asPro(db, userFor);
    expect((await postInvite(inviteReq(cookie, "tech@example.com"))).status).toBe(
      201,
    );
    const token = tokenFromMail(sent[0]!.text);
    const memberCookie = await magicCookie("tech@example.com");
    expect((await postAccept(acceptReq(memberCookie, token))).status).toBe(200);
    const again = await postInvite(inviteReq(cookie, "tech@example.com"));
    expect(again.status).toBe(409);
    const json = (await again.json()) as { error: string; code: string };
    expect(json.code).toBe("already_member");
  });

  it("re-invite while invited remints; old token is 410 or 404", async () => {
    const { db, userFor, sent } = await boot();
    const { cookie } = await asPro(db, userFor);
    const first = await postInvite(inviteReq(cookie, "tech@example.com"));
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { id: string };
    const oldToken = tokenFromMail(sent[0]!.text);

    const second = await postInvite(inviteReq(cookie, "tech@example.com"));
    expect(second.status).toBe(201);
    const secondJson = (await second.json()) as { id: string; status: string };
    expect(secondJson.id).toBe(firstJson.id);
    expect(secondJson.status).toBe("invited");
    expect(sent).toHaveLength(2);
    const newToken = tokenFromMail(sent[1]!.text);
    expect(newToken).not.toBe(oldToken);

    const rows = await db.select().from(teamMembers);
    expect(rows).toHaveLength(1);

    const memberCookie = await magicCookie("tech@example.com");
    const stale = await postAccept(acceptReq(memberCookie, oldToken));
    expect([404, 410]).toContain(stale.status);
    const fresh = await postAccept(acceptReq(memberCookie, newToken));
    expect(fresh.status).toBe(200);
  });

  it("owner DELETE member is 204", async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const invited = await postInvite(inviteReq(cookie, "tech@example.com"));
    const { id } = (await invited.json()) as { id: string };
    const res = await deleteMember(
      new Request(`http://sign.test/v1/team/members/${id}`, {
        method: "DELETE",
        headers: { cookie },
      }),
      memberCtx(id),
    );
    expect(res.status).toBe(204);
    const listed = await getTeam(
      new Request("http://sign.test/v1/team", { headers: { cookie } }),
    );
    const team = (await listed.json()) as TeamJson;
    expect(team.members.some((m) => m.id === id)).toBe(false);
  });

  it("member POST invite is 403 forbidden", async () => {
    const { db, userFor, sent } = await boot();
    const { cookie } = await asPro(db, userFor);
    expect((await postInvite(inviteReq(cookie, "tech@example.com"))).status).toBe(
      201,
    );
    const token = tokenFromMail(sent[0]!.text);
    const memberCookie = await magicCookie("tech@example.com");
    expect((await postAccept(acceptReq(memberCookie, token))).status).toBe(200);
    const res = await postInvite(inviteReq(memberCookie, "other@example.com"));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.code).toBe("forbidden");
  });

  it("owner + 9 invited rows, 10th invite is 400 team_full", async () => {
    const { db, userFor } = await boot();
    const { cookie, userId } = await asPro(db, userFor);
    for (let i = 0; i < 9; i++) {
      await db.insert(teamMembers).values({
        ownerUserId: userId,
        email: `m${i}@example.com`,
        status: "invited",
        tokenHash: `hash-${i}`.padEnd(64, "0"),
        invitedAt: new Date(),
      });
    }
    const res = await postInvite(inviteReq(cookie, "tenth@example.com"));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.code).toBe("team_full");
  });

  it("accept when already active on another team is 409 already_on_a_team", async () => {
    const { db, userFor, sent } = await boot();
    const { cookie: aCookie } = await asPro(db, userFor, "a@example.com");
    expect((await postInvite(inviteReq(aCookie, "tech@example.com"))).status).toBe(
      201,
    );
    const firstToken = tokenFromMail(sent[0]!.text);
    const memberCookie = await magicCookie("tech@example.com");
    expect((await postAccept(acceptReq(memberCookie, firstToken))).status).toBe(
      200,
    );

    const { cookie: bCookie } = await asPro(db, userFor, "b@example.com");
    expect((await postInvite(inviteReq(bCookie, "tech@example.com"))).status).toBe(
      201,
    );
    const secondToken = tokenFromMail(sent[1]!.text);
    const res = await postAccept(acceptReq(memberCookie, secondToken));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.code).toBe("already_on_a_team");
  });

  it("accept when caller plan is pro is 409 already_pro", async () => {
    const { db, userFor, sent } = await boot();
    const { cookie } = await asPro(db, userFor);
    expect((await postInvite(inviteReq(cookie, "tech@example.com"))).status).toBe(
      201,
    );
    const token = tokenFromMail(sent[0]!.text);
    const memberCookie = await magicCookie("tech@example.com");
    const memberId = userFor("tech@example.com").id;
    await db
      .update(accounts)
      .set({ plan: "pro" })
      .where(eq(accounts.userId, memberId));
    const res = await postAccept(acceptReq(memberCookie, token));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.code).toBe("already_pro");
  });

  it("accept when caller already owns a team_members row is 409 already_owns_a_team", async () => {
    const { db, userFor, sent } = await boot();
    const { cookie } = await asPro(db, userFor);
    expect((await postInvite(inviteReq(cookie, "tech@example.com"))).status).toBe(
      201,
    );
    const token = tokenFromMail(sent[0]!.text);
    const memberCookie = await magicCookie("tech@example.com");
    const memberId = userFor("tech@example.com").id;
    await db.insert(teamMembers).values({
      ownerUserId: memberId,
      email: "hire@example.com",
      status: "invited",
      tokenHash: "owned".padEnd(64, "0"),
      invitedAt: new Date(),
    });
    const res = await postAccept(acceptReq(memberCookie, token));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.code).toBe("already_owns_a_team");
  });
});

describe("teamSeatCount", () => {
  it("coerces postgres bigint strings so owner + rows is a number", () => {
    expect(1 + ("0" as unknown as number)).toBe("10");
    expect(teamSeatCount("0")).toBe(1);
    expect(teamSeatCount("9")).toBe(10);
    expect(teamSeatCount(0)).toBe(1);
    expect(teamSeatCount(9)).toBe(10);
    expect(teamSeatCount(null)).toBe(1);
    expect(teamSeatCount(undefined)).toBe(1);
    expect(teamSeatCount("0") >= 10).toBe(false);
    expect(teamSeatCount("9") >= 10).toBe(true);
  });
});

describe("team documents", () => {
  it("owner and member lists include both team sends", { timeout: 60_000 }, async () => {
    const { team, a, b } = await twoSends();
    const memberList = await listFor({ cookie: team.memberCookie });
    const ownerList = await listFor({ cookie: team.ownerCookie });
    expect(memberList.documents.map((e) => e.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    expect(ownerList.documents.map((e) => e.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );
  });

  it("owner can void member and own sends; member cannot void owner send", { timeout: 60_000 }, async () => {
    const { team, a, b } = await twoSends();
    const memberList = await listFor({ cookie: team.memberCookie });
    const ownerList = await listFor({ cookie: team.ownerCookie });
    expect(memberList.documents.find((e) => e.id === a.id)?.can_delete).toBe(
      false,
    );
    expect(memberList.documents.find((e) => e.id === b.id)?.can_delete).toBe(
      true,
    );
    expect(ownerList.documents.find((e) => e.id === a.id)?.can_delete).toBe(
      true,
    );
    expect(ownerList.documents.find((e) => e.id === b.id)?.can_delete).toBe(
      true,
    );

    const memberVoid = await deleteDocument(
      new Request(`http://sign.test/v1/documents/${a.id}`, {
        method: "DELETE",
        headers: { cookie: team.memberCookie },
      }),
      { params: Promise.resolve({ id: a.id }) },
    );
    expect(memberVoid.status).toBe(403);

    const ownerVoid = await deleteDocument(
      new Request(`http://sign.test/v1/documents/${a.id}`, {
        method: "DELETE",
        headers: { cookie: team.ownerCookie },
      }),
      { params: Promise.resolve({ id: a.id }) },
    );
    expect(ownerVoid.status).toBe(200);

    const ownerVoidMember = await deleteDocument(
      new Request(`http://sign.test/v1/documents/${b.id}`, {
        method: "DELETE",
        headers: { cookie: team.ownerCookie },
      }),
      { params: Promise.resolve({ id: b.id }) },
    );
    expect(ownerVoidMember.status).toBe(200);
  });

  it("member live key GET status of owner document is 200", { timeout: 60_000 }, async () => {
    const { team, a } = await twoSends();
    const res = await getDocument(
      new Request(`http://sign.test/v1/documents/${a.id}`, {
        headers: { authorization: `Bearer ${team.memberKey}` },
      }),
      { params: Promise.resolve({ id: a.id }) },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; status: string };
    expect(json.id).toBe(a.id);
    expect(json.status).toBe("pending");
  });

  it("free personal user is 429 at 20; Pro team member can send the 21st", { timeout: 60_000 }, async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    const team = await proTeam(
      "shop@example.com",
      "tech@example.com",
      () => frozen,
    );
    const freeCookie = await magicCookie("solo@example.com");
    const freeId = team.userFor("solo@example.com").id;
    const freeKey = await mintLive(freeCookie);
    await seedSends(team.db, freeId, "solo@example.com", 20, frozen);
    const pdf = await minimalPdf();
    const overBody = new FormData();
    overBody.set("title", "Over cap");
    overBody.set("sender_email", "solo@example.com");
    overBody.set(
      "signers",
      JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
    );
    overBody.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const over = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${freeKey}` },
        body: overBody,
      }),
    );
    expect(over.status).toBe(429);
    const json = (await over.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBeTruthy();
    expect(JSON.stringify(json)).not.toMatch(/20/);

    await seedSends(team.db, team.memberUserId, team.memberEmail, 20, frozen);
    const lifted = await sendLive(team.memberKey, "Twenty first");
    expect(lifted.status).toBe("pending");
  });

  it("member last-signer complete keeps ~365d because owner is Pro", { timeout: 60_000 }, async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    const team = await proTeam(
      "shop@example.com",
      "tech@example.com",
      () => frozen,
    );
    const { sent } = team;
    const created = await sendLive(team.memberKey, "Member send");
    const invite = sent.find((m) => m.to === "jane@example.com");
    expect(invite).toBeTruthy();
    const token = invite!.text.match(/\/s\/([A-Za-z0-9_-]+)/)![1]!;
    expect(
      (
        await postConsent(
          new Request(`http://sign.test/s/${token}/consent`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ consent: true }),
          }),
          { params: Promise.resolve({ token }) },
        )
      ).status,
    ).toBe(200);
    const sig = new FormData();
    sig.set("png", new Blob([png], { type: "image/png" }), "sig.png");
    expect(
      (
        await postSign(
          new Request(`http://sign.test/s/${token}/sign`, {
            method: "POST",
            body: sig,
          }),
          { params: Promise.resolve({ token }) },
        )
      ).status,
    ).toBe(200);
    const [env] = await team.db
      .select()
      .from(documents)
      .where(eq(documents.id, created.id));
    expect(env!.shredAt.getTime()).toBe(frozen.getTime() + 365 * 86_400_000);
    expect(env!.shredAt.getTime()).not.toBe(frozen.getTime() + 7 * 86_400_000);
  });

  it("extendKeep on owner lengthens member sends and does not steal another team", async () => {
    const { db, ownerUserId, memberUserId } = await proTeam();
    const signedAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-02T00:00:00Z");
    setDeps({ db, now: () => now });
    const [memberEnv] = await db
      .insert(documents)
      .values({
        title: "Member sent",
        senderEmail: "tech@example.com",
        status: "completed",
        userId: memberUserId,
        expiresAt: signedAt,
        shredAt: new Date(signedAt.getTime() + 7 * 86_400_000),
      })
      .returning();
    const otherOwner = randomUUID();
    const [otherEnv] = await db
      .insert(documents)
      .values({
        title: "Other team",
        senderEmail: "other@example.com",
        status: "completed",
        userId: otherOwner,
        expiresAt: signedAt,
        shredAt: new Date(signedAt.getTime() + 7 * 86_400_000),
      })
      .returning();
    await db.insert(signers).values({
      documentId: memberEnv!.id,
      name: "Jane",
      email: "jane@example.com",
      signingOrder: 1,
      tokenHash: "hash-member",
      signedAt,
    });
    await db.insert(signers).values({
      documentId: otherEnv!.id,
      name: "Pat",
      email: "pat@example.com",
      signingOrder: 1,
      tokenHash: "hash-other",
      signedAt,
    });

    await extendKeep(db, ownerUserId);

    const [memberAfter] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, memberEnv!.id));
    const [otherAfter] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, otherEnv!.id));
    expect(memberAfter!.shredAt.getTime()).toBe(
      signedAt.getTime() + 365 * 86_400_000,
    );
    expect(otherAfter!.shredAt.getTime()).toBe(
      signedAt.getTime() + 7 * 86_400_000,
    );
  });
});
