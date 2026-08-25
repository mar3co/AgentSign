import { and, count, eq, gte, inArray, ne, or } from "drizzle-orm";
import { accounts, documents, teamMembers, templates } from "../db/schema.js";
import { getEnv } from "../env.js";
import { activeAgentCount } from "../lib/agents.js";
import { getStripe } from "../lib/billing.js";
import { requireCaller } from "../lib/caller.js";
import { getDeps } from "../lib/deps.js";
import { AGENT_CAP, TEAM_CAP, TEMPLATE_CAP } from "../lib/entitlement.js";
import { teamForUser } from "../lib/team.js";
import { teamSeatCount } from "./team.js";

function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
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

async function requireBilling(req: Request) {
  const caller = await requireCaller(req, { allowOauth: false });
  if (!caller.ok) return caller;
  const team = await teamForUser(caller.db, caller.user.id);
  return { ok: true as const, caller, team };
}

export async function getBilling(req: Request): Promise<Response> {
  const gate = await requireBilling(req);
  if (!gate.ok) return gate.response;
  const { db, user } = gate.caller;
  const team = gate.team;
  const env = getEnv();
  const at = getDeps().now?.() ?? new Date();
  const windowDays = Number(env.FREE_SEND_WINDOW_DAYS);
  const windowStart = new Date(at.getTime() - windowDays * 86_400_000);
  const senderIds = team.memberUserIds.length > 0 ? team.memberUserIds : [user.id];

  const ownerEmail = team.ownerEmail?.trim().toLowerCase() ?? "";
  const who = [
    inArray(documents.userId, senderIds),
    ownerEmail ? eq(documents.senderEmail, ownerEmail) : undefined,
  ].filter((clause): clause is NonNullable<typeof clause> => Boolean(clause));
  const [sends] = await db
    .select({ n: count() })
    .from(documents)
    .where(
      and(
        who.length === 1 ? who[0] : or(...who),
        gte(documents.createdAt, windowStart),
        ne(documents.status, "pending_sender"),
      ),
    );

  const [memberN] = await db
    .select({ n: count() })
    .from(teamMembers)
    .where(eq(teamMembers.ownerUserId, team.ownerUserId));

  const [templateN] = await db
    .select({ n: count() })
    .from(templates)
    .where(eq(templates.ownerUserId, team.ownerUserId));

  const agentUsed = await activeAgentCount(db, team.ownerUserId);

  const [ownerAccount] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, team.ownerUserId));

  let payment_method: { brand: string; last4: string } | null = null;
  const stripe = getStripe();
  if (ownerAccount?.stripeCustomerId && stripe.getDefaultPaymentMethod) {
    try {
      payment_method = await stripe.getDefaultPaymentMethod(ownerAccount.stripeCustomerId);
    } catch {
      payment_method = null;
    }
  }

  return Response.json({
    plan: team.entitled ? "pro" : "free",
    entitled: team.entitled,
    role: user.id === team.ownerUserId ? "owner" : "member",
    current_period_end: ownerAccount?.currentPeriodEnd
      ? ownerAccount.currentPeriodEnd.toISOString()
      : null,
    usage: {
      sends: {
        used: Number(sends?.n ?? 0),
        limit: team.entitled ? null : Number(env.FREE_SEND_LIMIT),
        window_days: windowDays,
      },
      seats: { used: teamSeatCount(memberN?.n), limit: TEAM_CAP },
      templates: { used: Number(templateN?.n ?? 0), limit: TEMPLATE_CAP },
      agents: { used: agentUsed, limit: AGENT_CAP },
    },
    payment_method,
  });
}

export async function postBillingPortal(req: Request): Promise<Response> {
  const gate = await requireBilling(req);
  if (!gate.ok) return gate.response;
  if (!gate.team.entitled) {
    return jsonError(403, "Pro plan required", "pro_required");
  }
  const owner = requireOwner(gate.caller.user.id, gate.team.ownerUserId);
  if (!owner.ok) return owner.response;

  const [account] = await gate.caller.db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, gate.team.ownerUserId));
  if (!account?.stripeCustomerId) {
    return jsonError(400, "No billing customer", "no_customer");
  }
  const stripe = getStripe();
  if (!stripe.createBillingPortal) {
    return jsonError(500, "Portal unavailable", "portal_unavailable");
  }
  const origin = new URL(req.url).origin;
  const session = await stripe.createBillingPortal({
    customer: account.stripeCustomerId,
    return_url: `${origin}/settings/billing`,
  });
  if (!session.url) return jsonError(500, "Portal failed", "portal_failed");
  return new Response(null, {
    status: 303,
    headers: { location: session.url },
  });
}
