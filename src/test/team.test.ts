import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { POST as postAccept } from "../../app/team/accept/route.js";
import { GET as getTeam } from "../../app/v1/team/route.js";
import { POST as postInvite } from "../../app/v1/team/invites/route.js";
import { DELETE as deleteMember } from "../../app/v1/team/members/[id]/route.js";
import { accounts, cabinetMembers } from "../db/schema.js";
import { setDeps } from "../lib/deps.js";
import { teamSeatCount } from "../routes/team.js";
import { createTestDb } from "./db.js";

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
    expect(sent[0]!.subject).toBe("Join the Sign cabinet");
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

    const rows = await db.select().from(cabinetMembers);
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
      await db.insert(cabinetMembers).values({
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

  it("accept when already active on another cabinet is 409 already_on_a_team", async () => {
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

  it("accept when caller already owns a cabinet_members row is 409 already_owns_a_team", async () => {
    const { db, userFor, sent } = await boot();
    const { cookie } = await asPro(db, userFor);
    expect((await postInvite(inviteReq(cookie, "tech@example.com"))).status).toBe(
      201,
    );
    const token = tokenFromMail(sent[0]!.text);
    const memberCookie = await magicCookie("tech@example.com");
    const memberId = userFor("tech@example.com").id;
    await db.insert(cabinetMembers).values({
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
