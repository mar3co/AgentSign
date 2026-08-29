# AgentSign v1.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship mixed human/agent envelopes: humans Finish (ESIGN), agents Attest with a named-agent secret or account OAuth mapping; plus verify, reminder reprint, Free footer, per-agent webhooks, and live Vercel/Supabase/Flags on agentsign.co.

**Architecture:** Same Next.js App Router + Route Handlers + `setDeps`. New `agents` / OAuth tables hang off the cabinet owner. `signers.kind` is `human | agent`. Complete CAS still runs once; agent attest never re-seals. Flags are `flagOn("agent_parties" | "agent_only_attest")` with env overrides for tests. HTTP MCP grows OAuth 2.1 discovery; stdio stays pasted keys. No `sign` MCP tool.

**Tech Stack:** Existing (Next.js 15, Drizzle, PGlite, Vitest, pdf-lib, `@signpdf`, MCP SDK, shadcn/Base UI). Add `@vercel/flags`. Implement OAuth ourselves (PKCE S256, opaque `sign_oauth_` tokens hashed like API keys). Do not add Passport, NextAuth, or a second IdP.

Sources: [v1.2 spec](../specs/2026-08-21-agentsign-v1.2-design.md), [product plan](../../2026-08-19-product-plan.md), [name](../../name.md).

## Global Constraints

- Product name **AgentSign**. Canonical host `https://agentsign.co`. Key prefixes stay `sign_tmp_` / `sign_live_` / `sign_agent_`.
- Apache-2.0. Public repo `mar3co/AgentSign`. Do not commit `.grok/` or secrets.
- Primitive: **no field placer, `{{sig}}` tags, drafted legal language, `sign` MCP tool, auto-Finish, agent wet-ink PNG.** Those are GitHub #1 and #2.
- Humans Finish on `/s/:token`. Agents `attest`. Keys never Finish a human party. Certificate must not call attest an electronic signature.
- Free (including logged-in Free): account OAuth/`sign_live_` for `send`/`status`/`download` only. Named agents, `kind: agent`, `attest` → `403` `{ code: "pro_required" }`. Verify is unauthenticated.
- Pro / `SELF_HOST=1`: 10 active named agents per cabinet (`code: "agent_limit"`). Members use the owner’s agent list.
- `agent_parties` default **on**; `agent_only_attest` default **off**. Zero-human complete only when the latter is on.
- HTTP: Route Handlers + Zod, `runtime = "nodejs"`. Tests: exported handlers + `new Request`. `setDeps` / `afterEach(resetDeps)`. `fileParallelism: false`. `resetEnvCache()` after mutating env.
- Errors `{ "error": string, "code": string }`. No `?apiKey=`.
- TDD: failing test first, watch it fail, then production. Commit after each task.
- Fake AuthAdapter: copy `createFakeAuth` from `src/test/keys.test.ts` (cookie `sign_session=`, codes `magic:{email}`).
- CIMD and agent webhook URL fetches reuse `webhookUrlError` (SSRF denylist). Never `Access-Control-Allow-Origin: *` on `/mcp`.
- Do not vendor AGPL competitor code.

## File structure

```
src/env.ts                         # SIGN_FLAG_*, FLAGS_SECRET
src/lib/flags.ts                   # flagOn
src/lib/entitlement.ts             # AGENT_CAP = 10
src/lib/tokens.ts                  # newAgentKey, newOauthToken
src/lib/caller.ts                  # resolveBearer: live | agent | oauth
src/db/schema.ts                   # agents, oauth_*, signer kind, token_enc
src/lib/agents.ts                  # slug parse, loadAgent, active count
src/lib/oauth.ts                   # PKCE, codes, grants, CIMD fetch
src/lib/verify.ts                  # POST /v1/verify (seal check, no DB)
src/lib/webhooks.ts                # fireAgentWebhook; reuse HMAC/SSRF
src/lib/email.ts                   # reminder includes /s/ URL when token_enc
src/lib/pdf/appendSignaturePage.ts # agent appearance text; Free footer
src/lib/pdf/certificate.ts         # agent parties; human_signatures count
src/lib/pdf/complete.ts            # appearances without PNG for agents
src/routes/agents.ts
src/routes/envelopes.ts            # kind: agent parties; current_party
src/routes/attest.ts               # attest + reject
src/routes/signing.ts              # complete rules; skip /s/ for agents
src/routes/verify.ts
src/routes/oauth.ts
src/mcp/server.ts                  # attest, reject, verify, list_packets, send_packet
src/jobs/shred.ts                  # decrypt token_enc into reminder
src/openapi.ts
app/llms.txt/route.ts
public/llms.txt
app/v1/agents/route.ts
app/v1/agents/[id]/route.ts
app/v1/agents/[id]/rotate/route.ts
app/v1/agents/[id]/webhook/route.ts
app/v1/envelopes/[id]/attest/route.ts
app/v1/envelopes/[id]/reject/route.ts
app/v1/verify/route.ts
app/.well-known/oauth-protected-resource/route.ts
app/.well-known/oauth-authorization-server/route.ts
app/oauth/authorize/page.tsx
app/oauth/authorize/route.ts
app/oauth/token/route.ts
app/oauth/register/route.ts
app/agents/page.tsx
src/test/flags.test.ts
src/test/agents.test.ts
src/test/attest.test.ts
src/test/verify.test.ts
src/test/oauth.test.ts
src/test/reminders-reprint.test.ts  # or extend shred.test.ts
```

---

### Task 1: Flags helper

**Files:**
- Create: `src/lib/flags.ts`
- Modify: `src/env.ts` — `SIGN_FLAG_AGENT_PARTIES`, `SIGN_FLAG_AGENT_ONLY_ATTEST`, `FLAGS_SECRET` all `z.string().default("")`
- Modify: `.env.example` — commented flag env lines
- Test: `src/test/flags.test.ts`

**Interfaces:**
- Consumes: `getEnv()`, `resetEnvCache()`
- Produces:

```ts
export type FlagName = "agent_parties" | "agent_only_attest";
/** Env override wins. Else Vercel Flags when FLAGS_SECRET set. Else defaults. */
export async function flagOn(name: FlagName): Promise<boolean>;
export const FLAG_DEFAULTS: Record<FlagName, boolean> = {
  agent_parties: true,
  agent_only_attest: false,
};
```

Env: `"0"` / `"false"` → off; `"1"` / `"true"` → on; empty → default / Vercel.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { flagOn } from "../lib/flags.js";
import { resetEnvCache } from "../env.js";

afterEach(() => {
  delete process.env.SIGN_FLAG_AGENT_PARTIES;
  delete process.env.SIGN_FLAG_AGENT_ONLY_ATTEST;
  resetEnvCache();
});

it("agent_only_attest defaults off and env 1 turns it on", async () => {
  expect(await flagOn("agent_only_attest")).toBe(false);
  process.env.SIGN_FLAG_AGENT_ONLY_ATTEST = "1";
  resetEnvCache();
  expect(await flagOn("agent_only_attest")).toBe(true);
});

it("SIGN_FLAG_AGENT_PARTIES=0 turns agent_parties off", async () => {
  process.env.SIGN_FLAG_AGENT_PARTIES = "0";
  resetEnvCache();
  expect(await flagOn("agent_parties")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/test/flags.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write `flagOn`.** Do not call the Vercel API unless `FLAGS_SECRET` is non-empty. Tests must not need network.

- [ ] **Step 4: Run tests** — Expected: PASS

- [ ] **Step 5: Commit** `feat: add Vercel/env feature flags for agent parties`

---

### Task 2: Schema

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/lib/entitlement.ts` — `export const AGENT_CAP = 10;`
- Modify: `src/lib/tokens.ts` — `newAgentKey()`, `newOauthToken()` (`sign_oauth_` + 32 bytes hex, prefix first 12)
- Test: `src/test/schema.test.ts` (extend) and `src/test/tokens.test.ts`

**Interfaces:**
- Consumes: existing `apiKeyKind`, `signers`, `sealWebhookSecret` pattern
- Produces: tables and token helpers later tasks import by these exact names

`apiKeyKind` becomes `["tmp", "live", "agent"]`. `apiKeys.agentId` uuid nullable.

`partyKind = ["human", "agent"]`.

`signers` add:
- `kind` text enum `partyKind`, notNull, default `"human"`
- `agentId` uuid nullable
- `attestedAt`, `rejectedAt` timestamptz nullable
- `attestMethod` text nullable (`"agent_key"` | `"oauth"`)
- `attestLabel` text nullable
- `tokenHash` **nullable** (drop notNull; keep unique)
- `tokenEnc` text nullable

`auditEvent` add `"attested"`, `"rejected"`.

`agents` table: `id`, `ownerUserId`, `slug`, `name`, `webhookUrl`, `webhookSecretHash`, `createdAt`, `revokedAt`. Unique `(ownerUserId, slug)`. RLS on.

`oauthClients`: `id`, `clientId` unique text, `clientName`, `redirectUris` jsonb string[], `authMethod` text, `createdAt`.

`oauthGrants`: `id`, `userId`, `clientId`, `allowedAgentIds` jsonb uuid[] (default `[]`), `accessHash`, `refreshHash`, `expiresAt`, `revokedAt`.

`oauthCodes`: `id`, `codeHash`, `userId`, `clientId`, `redirectUri`, `codeChallenge`, `resource`, `allowedAgentIds` jsonb, `expiresAt`, `consumedAt`.

```ts
export function newAgentKey(): { raw: string; prefix: string; hash: string };
export function newOauthToken(): { raw: string; prefix: string; hash: string };
```

- [ ] **Step 1: Failing test** — insert an `agents` row and a `kind: "agent"` signer with `tokenHash: null` via `createTestDb()` (pushSchema). Also `newAgentKey().raw.startsWith("sign_agent_")`.

- [ ] **Step 2: Run** `pnpm exec vitest run src/test/schema.test.ts src/test/tokens.test.ts` — FAIL until columns exist.

- [ ] **Step 3: Schema + token helpers.** Do not add HTTP yet.

- [ ] **Step 4: PASS + `pnpm typecheck`**

- [ ] **Step 5: Commit** `feat: schema for named agents, party kind, and OAuth grants`

---

### Task 3: `/v1/agents` CRUD

**Files:**
- Create: `src/lib/agents.ts`
- Create: `src/routes/agents.ts`
- Create: `app/v1/agents/route.ts` (`runtime = "nodejs"`)
- Create: `app/v1/agents/[id]/route.ts`
- Create: `app/v1/agents/[id]/rotate/route.ts`
- Create: `app/v1/agents/[id]/webhook/route.ts`
- Modify: `src/lib/caller.ts` — live **or** session (unchanged) for these routes
- Test: `src/test/agents.test.ts`

**Interfaces:**
- Consumes: `requireCaller`, `cabinetForUser`, `isEntitled`, `AGENT_CAP`, `flagOn("agent_parties")`, `newAgentKey`, `sealWebhookSecret`, `webhookUrlError`
- Produces:

```ts
export function parseAgentSlug(raw: unknown): string | null; // /^[a-z0-9-]{1,40}$/, no leading/trailing hyphen
export async function activeAgentCount(db: AuditDb, ownerUserId: string): Promise<number>; // revokedAt IS NULL
```

JSON list item: `{ id, slug, name, has_webhook, created_at, revoked_at }`. Create response **also** `{ key, prefix }` once. Rotate same. Webhook PUT returns `{ webhook_secret }` once when URL set.

Codes: `403 pro_required`, `403 flag_off` (when `agent_parties` off), `403 not_owner` on writes if member, `400 agent_limit` on 11th active, `400 invalid_slug`, `409 slug_taken`, `404` unknown id.

- [ ] **Step 1: Failing tests** (copy `createFakeAuth` from `src/test/keys.test.ts`; mint Pro account `plan: "pro"`):

```ts
it("Free session cannot create an agent", async () => { /* POST /v1/agents → 403 pro_required */ });
it("Pro owner mints sign_agent_ once and list omits the raw key", async () => {});
it("11th active agent is 400 agent_limit", async () => {});
it("member cannot revoke the owner's agent", async () => {});
```

- [ ] **Step 2: Run** `pnpm exec vitest run src/test/agents.test.ts` — FAIL

- [ ] **Step 3: Implement routes.** Webhook URL optional on create; validate with `webhookUrlError`. Revoke sets `revokedAt`, does not delete. Active cap ignores revoked.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: Pro named agents with paste keys and cap 10`

---

### Task 4: Send path `kind: agent` + `current_party`

**Files:**
- Modify: `src/routes/envelopes.ts` — parse parties; skip `/s/` token + invite mail for agent parties; first **human** in order still gets the invite when they become current (existing sequential mail)
- Modify: GET envelope JSON
- Test: `src/test/create-envelope.test.ts` and/or `src/test/agents.test.ts`

**Interfaces:**
- Consumes: `flagOn`, `isEntitled` of the **sender cabinet**, `agents` by `(ownerUserId, slug)` where `revokedAt` is null. Principal `email` on an agent party must match the agent owner’s account email (case-insensitive).
- Produces: signer rows with `kind`, `agentId`; GET:

```ts
{
  current_party: { index: number; kind: "human" | "agent"; email: string; agent?: string } | null;
  signers: Array<{
    kind: "human" | "agent";
    email: string;
    agent?: string;
    signed_at: string | null;
    attested_at: string | null;
    declined_at: string | null;
    rejected_at: string | null;
    /* existing timestamp fields stay */
  }>;
}
```

`kind` omitted = `human`. `agent_parties` off + any agent party → `403 flag_off`. Free sender + agent party → `403 pro_required`. Unknown slug → `400 unknown_agent`. Agent party: `tokenHash` null, `tokenEnc` null, no invite email.

Sequential: do not email a later human until earlier parties are done (existing). Do not “invite” an agent (no mail). `current_party` is the first row missing `signedAt`/`attestedAt`/`declinedAt`/`rejectedAt` while envelope `pending`.

- [ ] **Step 1: Failing tests**

```ts
it("omitted kind still creates a human party", async () => {});
it("Pro live key can send A then H and GET shows current_party agent", async () => {});
it("Free live key send with kind agent is 403 pro_required", async () => {});
```

- [ ] **Step 2: FAIL** `pnpm exec vitest run src/test/create-envelope.test.ts src/test/agents.test.ts`

- [ ] **Step 3: Implement parse + insert.** Keep OTP one-off working for all-human lists.

- [ ] **Step 4: PASS** existing envelope tests must still pass.

- [ ] **Step 5: Commit** `feat: mixed human/agent parties on send and status`

---

### Task 5: `attest` / `reject` + complete rules

**Files:**
- Create: `src/routes/attest.ts`
- Create: `app/v1/envelopes/[id]/attest/route.ts`
- Create: `app/v1/envelopes/[id]/reject/route.ts`
- Modify: `src/lib/caller.ts` — accept `sign_agent_` and (from Task 8) OAuth; for this task, **agent key only** plus live/session that may attest as an agent they own (Pro owner or member). Live/session attest must send JSON `{ "agent": "grok-legal" }` naming the slug. Agent key infers the slug.
- Modify: `src/routes/signing.ts` — last-party complete: require ≥1 `signedAt` unless `flagOn("agent_only_attest")`. Reuse existing CAS-then-put. Building appearances: humans as today (PNG); agents: text-only block (Task 6 can finish drawing; this task may complete without seal if you call existing `completeEnvelope` only when a human signed — **must still seal A→H**). Prefer implementing seal input in Task 6; this task should: set `attestedAt`, audit `attested`, if last party then run the same complete transaction as last signer (or 400 `human_required`).
- Test: `src/test/attest.test.ts`

**Interfaces:**
- Consumes: `flagOn`, `lookupApiKey`, cabinet agents
- Produces:

```ts
export async function attestEnvelope(req: Request, envelopeId: string): Promise<Response>;
export async function rejectEnvelope(req: Request, envelopeId: string): Promise<Response>;
```

Attest CAS: `kind=agent`, `attestedAt` IS NULL, `rejectedAt` IS NULL, envelope `pending`, this party is `current_party`. On last party: if no human `signedAt` and flag off → **do not** set attested? Spec: the attest that would complete zero-human returns `400 human_required` and leaves pending. Implement as: compute wouldComplete; if wouldComplete && !anySigned && !flag → return 400 without writing attested (so retries work) **or** write attested but skip complete. **Pick: write attested, leave envelope pending, return 400 `human_required`.** A later human cannot be added; A→A stays pending until flag or void. Document that in the test name.

`sign_live_` without `{ agent }` and not an agent key → `403 cannot_attest`.

Reject: set `rejectedAt`, envelope `declined`, audit `rejected`. CAS same current-party.

- [ ] **Step 1: Failing tests**

```ts
it("agent key attests current agent party", async () => {});
it("sign_live_ cannot attest without naming an allowed agent", async () => {});
it("A→A last attest with flag off is 400 human_required and not completed", async () => {});
it("A→A with SIGN_FLAG_AGENT_ONLY_ATTEST=1 completes", async () => {});
it("concurrent double attest: one 200 one 409", async () => {});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement CAS like `src/routes/signing.ts` last-signer (update … returning).** Do not add a `sign` tool.

- [ ] **Step 4: PASS** + existing signing tests.

- [ ] **Step 5: Commit** `feat: agent attest and reject with human_required complete rule`

---

### Task 6: Appearance, certificate, verify, Free footer

**Files:**
- Modify: `src/lib/pdf/appendSignaturePage.ts` — extend `SignatureAppearance` with optional `kind?: "human" | "agent"` and `footer?: string`. Agent: no PNG required; draw “Attested by {name} for {email} at {ISO}. Not an electronic signature.” Zero-human: draw banner “No human electronic signature. Agent attestations only.” Footer when `footer` set: “Sent with AgentSign” at bottom. Certificate: **no** footer.
- Modify: `src/lib/pdf/certificate.ts` — extend `CertificateSigner` with `kind`, `attestedAt`, `attestMethod`, `attestLabel`, `agentSlug`. Print human vs agent blocks. Envelope lines `human_signatures: N` and `agent_attestations: M`. Consent sentence only if any human `consentedAt`.
- Modify: `src/lib/pdf/complete.ts` — allow agent appearances without png.
- Modify: `src/routes/signing.ts` / `src/routes/attest.ts` — when completing, build appearances from all parties; set `footer` if `!cabinet.entitled`.
- Create: `src/lib/verify.ts` + `src/routes/verify.ts` + `app/v1/verify/route.ts`
- Test: `src/test/verify.test.ts`, extend `src/test/signing.test.ts` / `src/test/attest.test.ts`

**Interfaces:**

```ts
export type VerifyResult = {
  valid: boolean;
  code?: string;
  sha256?: string;
  envelope_id?: string;
  human_signatures?: number;
  agent_attestations?: number;
  parties?: Array<{ kind: string; email: string; signed_at?: string; attested_at?: string }>;
};
export async function verifySealedPdf(bytes: Uint8Array): Promise<VerifyResult>;
export async function verifyEnvelope(req: Request): Promise<Response>; // POST body raw pdf or multipart file
```

`valid: false`, `code: "not_our_seal"` if ByteRange/P12 fail. No auth. No DB required: parse text you drew (byte-searchable `drawLiteralText`). Embed `envelope_id` on the appearance or cert page as today if present; if not found, omit.

- [ ] **Step 1: Failing tests** — complete A→H; `verify` `valid: true` and `human_signatures >= 1`; Free complete appearance bytes include `Sent with AgentSign`; Pro does not; tampered bytes `valid: false`.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement drawing + verify.** Do not put the footer on the sibling certificate.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: agent appearance, factual cert, verify, Free footer`

---

### Task 7: MCP tools + OpenAPI/llms (partial)

**Files:**
- Modify: `src/mcp/server.ts` — register `attest`, `reject`, `verify`, `list_packets`, `send_packet`. Instructions: “No sign tool. Humans Finish. Agents Attest.”
- Modify: `src/openapi.ts` — agents, attest, reject, verify paths; version `1.2.0`
- Modify: `app/llms.txt/route.ts` and `public/llms.txt` — list new tools; still no `sign`
- Test: `src/test/mcp.test.ts`

**Interfaces:** MCP `attest` args: `{ envelope_id: z.string(), agent: z.string().optional(), api_key: z.string().optional() }`. `verify` args: `{ pdf: z.string() }` base64. `list_packets` / `send_packet` wrap existing packet routes with Bearer from `resolveKey` (same as `send`). HTTP MCP still must not use `SIGN_API_KEY`.

- [ ] **Step 1: Failing test** — tools/list includes `attest` and `verify` and does not include `sign`. `list_packets` exists.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement wrappers** like existing `send` (FormData/Request into route functions).

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: MCP attest, verify, packets; OpenAPI 1.2`

---

### Task 8: MCP OAuth (account) + agent mapping

**Files:**
- Create: `src/lib/oauth.ts`
- Create: `src/routes/oauth.ts`
- Create well-known + `/oauth/token` + `/oauth/register` Route Handlers (`runtime = "nodejs"`)
- Create: `app/oauth/authorize/page.tsx` + POST handler
- Modify: `src/mcp/server.ts` `handleMcpHttp` — missing Bearer → 401 + `WWW-Authenticate: Bearer resource_metadata="https://…/.well-known/oauth-protected-resource", scope="send status download"`
- Modify: `src/lib/caller.ts` / MCP auth — Bearer `sign_oauth_` looks up `oauth_grants` by `accessHash`
- Test: `src/test/oauth.test.ts`

**Interfaces:**

```ts
export function pkceS256(verifier: string): string; // base64url(sha256(verifier))
export async function fetchClientMetadata(clientIdUrl: string): Promise<{ client_id: string; client_name: string; redirect_uris: string[] } | { error: string }>;
```

CIMD: if `client_id` is `https:` URL, GET it via existing SSRF `webhookUrlError`; require JSON `client_id` exact match + `redirect_uris`. DCR: `POST /oauth/register` public client `token_endpoint_auth_method: "none"`, store `oauth_clients`.

Authorize: session required (redirect `/login?next=`). Consent POST body: `client_id`, `redirect_uri`, `state`, `code_challenge`, `resource`, `agent_ids[]` (optional; default all active agents if Pro, else `[]`). Issue `oauth_codes` TTL 10 minutes. Token: `grant_type=authorization_code` + PKCE S256 + `resource` must match MCP canonical URI (`appOrigin() + "/mcp"`). Access token `sign_oauth_` raw shown once, hash stored, TTL 1 hour; refresh rotates.

Grant with `allowed_agent_ids: []` can send/status/download, **cannot** attest (`403 cannot_attest`).

- [ ] **Step 1: Failing tests**

```ts
it("POST /mcp without Bearer is 401 with resource_metadata", async () => {});
it("PKCE authorize+token yields Bearer that can send", async () => {});
it("OAuth grant with empty allowed_agent_ids cannot attest", async () => {});
it("CIMD client_id to a blocked host is rejected", async () => {});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement.** Audience bind: store `resource` on the grant; MCP rejects token if resource ≠ this MCP. Do not accept Supabase JWTs on `/mcp`.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: MCP OAuth 2.1 with PKCE and agent mapping`

---

### Task 9: Reminder reprint + per-agent webhooks

**Files:**
- Modify: `src/routes/envelopes.ts` — when minting a human `/s/` token, `tokenEnc = sealWebhookSecret(raw)`
- Modify: `src/jobs/shred.ts` `remindDue` — if `tokenEnc`, `openWebhookSecret` and pass URL into `reminderEmail`; skip agent parties (`kind === "agent"`)
- Modify: `src/lib/email.ts` `reminderEmail` — optional `signUrl?: string`; if present, include `absoluteUrl(signUrl)` instead of “Use the unique signing link we already sent you.”
- Modify: `src/lib/webhooks.ts` — `fireAgentWebhook(agent, event, payload)` same HMAC `sha256=`, timestamp header, SSRF pin as envelope webhooks
- Modify: `src/routes/attest.ts` / `src/routes/signing.ts` / invite-next-party — when `current_party` becomes an agent, fire `party.ready`. On complete/decline/expire, fire agent webhooks for each agent party **and** keep envelope `envelope.completed`.
- Test: extend `src/test/shred.test.ts`, `src/test/webhooks.test.ts`, `src/test/attest.test.ts`

**Interfaces:**

```ts
export async function fireAgentWebhook(
  agent: { webhookUrl: string | null; webhookSecretHash: string | null },
  payload: { event: string; id: string; agent: string; status: string },
): Promise<void>;
```

Payload: no tokens, no `sign_agent_`, no webhook secrets.

- [ ] **Step 1: Failing tests** — freeze clock, human with `tokenEnc`, `remindDue` mail contains `/s/`; hash unchanged. Agent `party.ready` HMAC verifies. Envelope completed webhook still fires.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement.** Hash-only legacy humans: keep old reminder copy.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: reprint /s/ on reminders and per-agent webhooks`

---

### Task 10: `/agents` + OAuth consent UI

**Files:**
- Create: `app/agents/page.tsx` — list/create/rotate/revoke/webhook; Pro gate with upgrade CTA; `can_edit` owner-only writes
- Modify: `app/oauth/authorize/page.tsx` — client name, multi-select agents if Pro, submit to POST authorize
- Modify: cabinet chrome (same nav as branding/packets/team) — add Agents link for entitled users
- Modify: ceremony `app/s/[token]/page.tsx` — if earlier agent attested, factual line “{slug} attested for {email}”
- Test: `src/test/agents.test.ts` HTML smoke (render GET `/agents` 403 CTA for Free; 200 form for Pro owner) matching branding page tests

- [ ] **Step 1: Failing test** — Free GET `/agents` contains upgrade; Pro owner contains “Create agent”.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Pages with shadcn/Base UI.** No fake agent form on Free.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: agents settings and OAuth consent pages`

---

### Task 11: Copy pass AgentSign

**Files:** UI strings, certificate product line, `app/llms.txt/route.ts`, `public/llms.txt`, `src/openapi.ts` `info.title`, `FROM_EMAIL` default may stay until cloud. Homepage hero. MCP server `{ name: "agentsign", version: "1.2.0" }` (keep bin `sign-mcp` to avoid breaking local links, or add alias — **keep `sign-mcp` bin**, change display name only).
- Test: existing llms/openapi tests updated for AgentSign + no `sign` tool.

- [ ] **Step 1: Failing test** — llms.txt contains `AgentSign` and `attest`, not “AI signed”.

- [ ] **Step 2–4:** string replace user-facing Sign → AgentSign. Do **not** rename `sign_tmp_` / tables / routes `/s/`.

- [ ] **Step 5: Commit** `docs: user-facing copy is AgentSign`

---

### Task 12: Live Vercel, Supabase, Cloudflare DNS, Flags

**Files:** none in git except maybe `.env.example` comments for production URLs. Do **not** commit secrets.

This is ops, not TDD. Still sequential and reviewable.

- [ ] **Step 1:** `pnpm typecheck` and `pnpm test` green on `main`.
- [ ] **Step 2:** Create Vercel project linked to `mar3co/AgentSign` (Fluid Compute, Node, existing cron `/internal/shred`). Do not use Edge for seal.
- [ ] **Step 3:** Supabase: list orgs, `get_cost` for a new project, print the cost, then create project (Auth + Postgres + Storage bucket `envelopes`). Apply schema (drizzle push or SQL from `src/db/schema.ts`). Enable Google/GitHub providers only after env is in Vercel. RLS on; no grants to `anon`.
- [ ] **Step 4:** Vercel env: `DATABASE_URL`, `SUPABASE_*`, `APP_URL=https://agentsign.co`, `CRON_SECRET`, `WEBHOOK_KEK`, `P12_*`, Stripe/Resend when ready, `FLAGS_SECRET`.
- [ ] **Step 5:** `vercel flags create agent_parties` (boolean, production **enable**). `vercel flags create agent_only_attest` (boolean, production **disable**).
- [ ] **Step 6:** Cloudflare MAR3 Technologies: zone `agentsign.co` — apex + `www` to Vercel. Zone `agentsign.net` — 301/redirect to `https://agentsign.co`. Do not proxy-break Vercel TLS; follow current Vercel+Cloudflare CNAME/A docs.
- [ ] **Step 7:** Smoke: `GET https://agentsign.co/llms.txt` contains AgentSign; `POST /mcp` unauthenticated is 401 with `resource_metadata`.
- [ ] **Step 8:** Commit nothing secret. If DNS docs land in README, commit `docs: agentsign.co cloud wiring notes` only.

Do not create a second Stripe Price. Do not enable `agent_only_attest` in production.

---

## Self-review (coverage)

| Spec section | Task |
|---|---|
| Name, repo, domains | 11, 12 |
| Parties / sequential | 4 |
| OAuth account + mapping | 8, 10 |
| Complete rules + flags | 1, 5 |
| Entitlement Free vs Pro | 3, 4, 5 |
| REST + MCP | 3–7 |
| Seal, cert, verify, footer | 6 |
| Data model | 2 |
| UI | 10 |
| Reminder reprint, agent webhooks | 9 |
| Cloud + Flags dashboard | 12 |
| Non-goals #1 #2 | Global constraints; no task implements them |
