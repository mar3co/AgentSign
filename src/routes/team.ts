import { and, count, eq } from "drizzle-orm";
import { accounts, teamMembers } from "../db/schema.js";
import { getEnv } from "../env.js";
import { teamForUser } from "../lib/team.js";
import { requireCaller } from "../lib/caller.js";
import { getDeps } from "../lib/deps.js";
import { createMailer, teamInviteEmail } from "../lib/email.js";
import { TEAM_CAP } from "../lib/entitlement.js";
import { equalHex } from "../lib/hash.js";
import { hashSigningToken, newSigningToken } from "../lib/tokens.js";

const INVITE_MS = 7 * 86_400_000;

/** Owner is not a row. postgres count(*) is bigint and arrives as a string. */
export function teamSeatCount(
  rowCount: number | string | bigint | null | undefined,
): number {
  return 1 + Number(rowCount ?? 0);
}

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

function now(): Date {
  return getDeps().now?.() ?? new Date();
}

function requireOwner(
  callerId: string,
  ownerUserId: string,
): { ok: true } | { ok: false; response: Response } {
  if (callerId !== ownerUserId) {
    return { ok: false, response: jsonError(403, "Forbidden", "forbidden") };
  }
  return { ok: true };
}

async function requireTeamCaller(req: Request) {
  const caller = await requireCaller(req, { allowOauth: false });
  if (!caller.ok) return caller;
  const team = await teamForUser(caller.db, caller.user.id);
  return { ok: true as const, caller, team };
}

async function requireEntitledOwner(req: Request) {
  const gate = await requireTeamCaller(req);
  if (!gate.ok) return gate;
  if (!gate.team.entitled) {
    return {
      ok: false as const,
      response: jsonError(403, "Pro plan required", "pro_required"),
    };
  }
  const owner = requireOwner(gate.caller.user.id, gate.team.ownerUserId);
  if (!owner.ok) return owner;
  return gate;
}

function teamJson(
  team: Awaited<ReturnType<typeof teamForUser>>,
  callerId: string,
) {
  return {
    owner_email: team.ownerEmail,
    entitled: team.entitled,
    role: callerId === team.ownerUserId ? ("owner" as const) : ("member" as const),
    members: [
      {
        id: team.ownerUserId,
        email: team.ownerEmail,
        status: "active" as const,
        role: "owner" as const,
      },
      ...team.members.map((m) => ({
        id: m.id,
        email: m.email,
        status: m.status,
        role: "member" as const,
      })),
    ],
  };
}

function normEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

async function sendInviteMail(email: string, rawToken: string): Promise<void> {
  const mail = teamInviteEmail({ acceptUrl: `/team/accept?token=${rawToken}` });
  const mailer = getDeps().mailer ?? createMailer();
  await mailer.sendMail({ to: email, ...mail });
}

export async function getTeam(req: Request): Promise<Response> {
  const gate = await requireTeamCaller(req);
  if (!gate.ok) return gate.response;
  return Response.json(teamJson(gate.team, gate.caller.user.id));
}

export async function inviteMember(req: Request): Promise<Response> {
  const gate = await requireEntitledOwner(req);
  if (!gate.ok) return gate.response;

  const body = await readJson(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  const email = normEmail((body as { email?: unknown }).email);
  if (!email) {
    return jsonError(400, "Email is required", "invalid_request");
  }

  const { db } = gate.caller;
  const ownerUserId = gate.team.ownerUserId;
  const [existing] = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.ownerUserId, ownerUserId),
        eq(teamMembers.email, email),
      ),
    );
  if (existing?.status === "active") {
    return jsonError(409, "Already a member", "already_member");
  }

  const token = newSigningToken();
  const at = now();

  if (existing?.status === "invited") {
    await db
      .update(teamMembers)
      .set({ tokenHash: token.hash, invitedAt: at })
      .where(eq(teamMembers.id, existing.id));
    await sendInviteMail(email, token.raw);
    return Response.json(
      { id: existing.id, email, status: "invited" },
      { status: 201 },
    );
  }

  const [n] = await db
    .select({ n: count() })
    .from(teamMembers)
    .where(eq(teamMembers.ownerUserId, ownerUserId));
  if (teamSeatCount(n?.n) >= TEAM_CAP) {
    return jsonError(400, "Team is full", "team_full");
  }

  const [row] = await db
    .insert(teamMembers)
    .values({
      ownerUserId,
      email,
      status: "invited",
      tokenHash: token.hash,
      invitedAt: at,
    })
    .returning();
  await sendInviteMail(email, token.raw);
  return Response.json(
    { id: row.id, email: row.email, status: "invited" },
    { status: 201 },
  );
}

export async function removeMember(req: Request, id: string): Promise<Response> {
  const gate = await requireTeamCaller(req);
  if (!gate.ok) return gate.response;
  const owner = requireOwner(gate.caller.user.id, gate.team.ownerUserId);
  if (!owner.ok) return owner.response;
  if (!id) {
    return jsonError(400, "Member id is required", "invalid_request");
  }

  const [row] = await gate.caller.db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.id, id),
        eq(teamMembers.ownerUserId, gate.team.ownerUserId),
      ),
    );
  if (!row) {
    return jsonError(404, "Member not found", "not_found");
  }
  await gate.caller.db.delete(teamMembers).where(eq(teamMembers.id, id));
  return new Response(null, { status: 204 });
}

async function readAcceptToken(req: Request): Promise<string | null> {
  const ct = req.headers.get("content-type") ?? "";
  if (
    ct.includes("multipart/form-data") ||
    ct.includes("application/x-www-form-urlencoded")
  ) {
    const form = await req.formData();
    const raw = form.get("token");
    return typeof raw === "string" ? raw.trim() : null;
  }
  const body = await readJson(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = (body as { token?: unknown }).token;
  return typeof raw === "string" ? raw.trim() : null;
}

export async function acceptInvite(req: Request): Promise<Response> {
  const caller = await requireCaller(req);
  if (!caller.ok) return caller.response;
  if (caller.via !== "session") {
    return jsonError(401, "Unauthorized", "unauthorized");
  }

  const token = await readAcceptToken(req);
  if (!token) {
    return jsonError(400, "Token is required", "invalid_request");
  }

  const hash = hashSigningToken(token);
  const [invite] = await caller.db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.tokenHash, hash));
  if (!invite || !equalHex(invite.tokenHash, hash)) {
    return jsonError(404, "Invite not found", "not_found");
  }

  const at = now();
  if (at.getTime() >= invite.invitedAt.getTime() + INVITE_MS) {
    return jsonError(410, "This invite has expired", "expired");
  }

  const sessionEmail = caller.user.email.trim().toLowerCase();
  if (sessionEmail !== invite.email) {
    return jsonError(403, "Invite email does not match this session", "forbidden");
  }

  const [active] = await caller.db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, caller.user.id),
        eq(teamMembers.status, "active"),
      ),
    );
  if (active) {
    return jsonError(409, "Already on a team", "already_on_a_team");
  }

  const [owned] = await caller.db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.ownerUserId, caller.user.id));
  if (owned) {
    return jsonError(409, "Already owns a team", "already_owns_a_team");
  }

  const flag = getEnv().SELF_HOST.trim().toLowerCase();
  const selfHost = flag === "1" || flag === "true";
  const [account] = await caller.db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, caller.user.id));
  if (!selfHost && account?.plan === "pro") {
    return jsonError(409, "Already on a Pro plan", "already_pro");
  }

  const [updated] = await caller.db
    .update(teamMembers)
    .set({
      userId: caller.user.id,
      status: "active",
      acceptedAt: at,
    })
    .where(eq(teamMembers.id, invite.id))
    .returning();

  return Response.json({
    id: updated.id,
    email: updated.email,
    status: "active",
  });
}
