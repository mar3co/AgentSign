import { and, count, eq, gte, inArray, ne } from "drizzle-orm";
import { promises as dns } from "node:dns";
import { accounts, documents, teamMembers, templates } from "../db/schema.js";
import { appOrigin, getEnv } from "../env.js";
import { activeAgentCount } from "../lib/agents.js";
import { getStripe } from "../lib/billing.js";
import { requireCaller } from "../lib/caller.js";
import { getDeps } from "../lib/deps.js";
import { AGENT_CAP, TEAM_CAP, TEMPLATE_CAP } from "../lib/entitlement.js";
import { teamForUser } from "../lib/team.js";
import { teamSeatCount } from "./team.js";

const HOST_RE =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

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

function cnameTarget(): string {
  try {
    return new URL(appOrigin()).hostname.toLowerCase();
  } catch {
    return "localhost";
  }
}

function domainJson(team: Awaited<ReturnType<typeof teamForUser>>) {
  return {
    hostname: team.customDomain,
    verified: Boolean(team.customDomain && team.customDomainVerifiedAt),
    cname_target: cnameTarget(),
  };
}

function parseHostname(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; response: Response } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") {
    return {
      ok: false,
      response: jsonError(400, "hostname must be a string", "invalid_request"),
    };
  }
  const value = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!value) return { ok: true, value: null };
  if (value.startsWith("http://") || value.startsWith("https://") || value.includes("/")) {
    return {
      ok: false,
      response: jsonError(400, "hostname must not include a URL scheme", "invalid_request"),
    };
  }
  if (!HOST_RE.test(value)) {
    return {
      ok: false,
      response: jsonError(400, "Invalid hostname", "invalid_request"),
    };
  }
  const target = cnameTarget();
  if (value === target) {
    return {
      ok: false,
      response: jsonError(400, "Hostname cannot be the app origin", "invalid_request"),
    };
  }
  return { ok: true, value };
}

async function resolveCname(hostname: string): Promise<string[]> {
  const injected = getDeps().resolveCname;
  if (injected) return injected(hostname);
  try {
    return await dns.resolveCname(hostname);
  } catch {
    return [];
  }
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

  const [sends] = await db
    .select({ n: count() })
    .from(documents)
    .where(
      and(
        inArray(documents.userId, senderIds),
        gte(documents.createdAt, windowStart),
        ne(documents.status, "pending_sender"),
        ne(documents.status, "deleted"),
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
    domain: domainJson(team),
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

export async function putBillingDomain(req: Request): Promise<Response> {
  const gate = await requireBilling(req);
  if (!gate.ok) return gate.response;
  if (!gate.team.entitled) {
    return jsonError(403, "Pro plan required", "pro_required");
  }
  const owner = requireOwner(gate.caller.user.id, gate.team.ownerUserId);
  if (!owner.ok) return owner.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "Invalid JSON", "invalid_request");
  }
  const parsed = parseHostname((body as { hostname?: unknown }).hostname);
  if (!parsed.ok) return parsed.response;

  if (parsed.value) {
    const [taken] = await gate.caller.db
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(eq(accounts.customDomain, parsed.value));
    if (taken && taken.userId !== gate.team.ownerUserId) {
      return jsonError(409, "Domain already in use", "domain_taken");
    }
  }

  await gate.caller.db
    .update(accounts)
    .set({
      customDomain: parsed.value,
      customDomainVerifiedAt: null,
    })
    .where(eq(accounts.userId, gate.team.ownerUserId));

  const updated = await teamForUser(gate.caller.db, gate.caller.user.id);
  return Response.json(domainJson(updated));
}

export async function verifyBillingDomain(req: Request): Promise<Response> {
  const gate = await requireBilling(req);
  if (!gate.ok) return gate.response;
  if (!gate.team.entitled) {
    return jsonError(403, "Pro plan required", "pro_required");
  }
  const owner = requireOwner(gate.caller.user.id, gate.team.ownerUserId);
  if (!owner.ok) return owner.response;

  const hostname = gate.team.customDomain;
  if (!hostname) {
    return jsonError(400, "No domain to verify", "invalid_request");
  }
  const target = cnameTarget();
  const records = await resolveCname(hostname);
  const ok = records.some(
    (r) => r.replace(/\.$/, "").toLowerCase() === target,
  );
  if (!ok) {
    return jsonError(400, "CNAME does not match", "domain_unverified");
  }
  const at = getDeps().now?.() ?? new Date();
  await gate.caller.db
    .update(accounts)
    .set({ customDomainVerifiedAt: at })
    .where(eq(accounts.userId, gate.team.ownerUserId));
  const updated = await teamForUser(gate.caller.db, gate.caller.user.id);
  return Response.json(domainJson(updated));
}
