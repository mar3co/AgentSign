# AgentSign v1.2 Design — Agent parties, OAuth, verify

**Date:** 2026-08-21  
**Status:** Locked for implementation  
**Product:** AgentSign  
**Repo:** [yohanmarshall/AgentSign](https://github.com/yohanmarshall/AgentSign)  
**Product plan:** [docs/2026-08-19-product-plan.md](../../2026-08-19-product-plan.md)  
**Depends on:** v1 + v1.1 on `main` (`0598a0c`)

---

## 1. Intent

AgentSign is still a **signing primitive**: send, sign, fetch. A party on an envelope is a **human** or an **agent acting for a human**. Sequences (H→H, A→H, H→A, A→H→A→H, A→A) are the same engine with mixed `kind`s — not separate products.

- Humans **Finish** (`signed_at`). That is the only ESIGN/UETA electronic signature.
- Agents **Attest** (`attested_at`). Cryptographic receipt that this named official agent accepted these bytes. Never `signed_at`. No `sign` MCP tool. No auto-Finish.
- Completing with **zero** human signatures is a Vercel flag (`agent_only_attest`, default off).

Grok (or any MCP host) in legal mode drafts the PDF **in the host**. AgentSign does not draft legal language. The bot sends bytes, polls, downloads, verifies. A human still Finishes unless the flag is on and every party is an agent.

Also in this slice (parked from v1, now in): reminder reprint of the same `/s/` URL, Free “Sent with AgentSign” appearance footer, per-agent inbound webhooks, live Vercel + Supabase projects so dashboard flags work.

Still **$19 Pro**. No new SKU. No seats.

---

## 2. Name, repo, domains

| Place | Form |
|---|---|
| Spoken / invoices / certificate product line | **AgentSign** (one word) |
| GitHub | `yohanmarshall/AgentSign` (public, Apache-2.0) |
| Canonical host | **https://agentsign.co** |
| Alias | **agentsign.net** → 301 to `agentsign.co` |
| DNS | Cloudflare, account **MAR3 Technologies**. Zones already active. |
| Compute | Vercel (Next.js, Node runtime). Do not move the app to Workers. |
| Keys | Unchanged prefixes: `sign_tmp_`, `sign_live_`, `sign_agent_` |
| npm / folder | `sign` until a rename pass in this slice’s last task (UI copy, `/llms.txt`, OpenAPI `info.title`, footer). Do not rename key prefixes. |

`docs/name.md` previously rejected AgentSign. That decision is **overridden**. The domains exist; the agent-official-receipt story is the product.

---

## 3. Parties

An envelope is one PDF, one ordered list, sequential. The current party is the only one who can act.

| | Human | Agent |
|---|---|---|
| JSON | `{ "kind": "human", "name", "email" }` | `{ "kind": "agent", "name", "email", "agent" }` |
| `email` | The signer | The **principal** (human account this bot acts for) |
| `agent` | omitted | Slug on that principal’s cabinet (`grok-legal`) |
| Credential | `/s/:token` in mail | Named-agent paste key or account OAuth allowed to attest as that slug |
| Completes by | Consent + draw + Finish | `POST …/attest` |
| Recorded as | `signed_at`, IP, UA, consent | `attested_at`, agent slug, auth method |
| Legal copy | ESIGN/UETA electronic signature | **Not** a signature. “Attested by {slug} for {email}.” |

`kind` omitted on `POST /v1/envelopes` = `human` (today’s clients keep working). Unknown slug → `400 unknown_agent`. Flag `agent_parties` off → `403 flag_off` if any party is an agent.

Agent parties have **no** `/s/` token. `token_hash` is nullable; unique when present.

---

## 4. Account OAuth, named agents, mapping

Three layers:

1. **Account** — session cookie, `sign_live_`, or **MCP OAuth access token**. “A machine acting as Alice.” Any MCP client that speaks OAuth 2.1 + PKCE is welcome. No connector allowlist.
2. **Named agents** — slugs on the **cabinet owner** (`grok-legal`, `claude-ops`). Who can **attest**. Not the OAuth subject.
3. **Credentials**
   - **Paste `sign_agent_`** — bound to one agent. Stdio / hosts that take a secret. Hash-only, shown once, rotatable, revocable. Timing-safe compare. **Cannot** be used to attest as a different slug.
   - **OAuth (or live key)** — bound to the **account**. Send / status / download / list. To attest, the call names `agent`. We check the principal owns it **and** the grant’s `allowed_agent_ids` includes it.

**Consent (`/oauth/authorize`):** existing Supabase login if needed. “{client_name} wants to use your AgentSign account.” Send/status/download always. If Pro and the user has agents: multi-select “Allow attest as…” (default: all current). Free: no attest checkboxes. One grant → **set** of agents, not one agent. A second connector is a second grant.

`sign_live_` never attests. Cabinet keys keep doing REST for humans and scripts.

**HTTP MCP authorization** (spec 2025-11-25):

- Unauthenticated `POST /mcp` → `401` + `WWW-Authenticate` with `resource_metadata`
- `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`
- OAuth 2.1 + PKCE `S256`; `resource` = this MCP; tokens audience-bound to AgentSign MCP (not Supabase JWTs, no passthrough)
- Client registration: **CIMD** first (HTTPS `client_id` URL; fetch with the existing webhook SSRF denylist), **DCR** fallback
- stdio MCP does **not** do OAuth (env / pasted `sign_agent_` or `SIGN_API_KEY` only)

---

## 5. Flows, complete, flags

| Chain | What happens |
|---|---|
| H→H | Today. Both Finish. |
| A→H | Bot sends. Human Finishes. Completes. Bot `download`s. Legal-mode. |
| H→A | Human sends. Agent attests when current. Completes because a human signed. |
| A→H→A→H | Sequential mixed. Last human Finish seals. |
| A→A | Both attest. Completes **only** if `agent_only_attest` is on. |

**Complete** (same CAS idea as last-signer today): every party has `signed_at` or `attested_at`, **and** at least one `signed_at` exists.

If the last done party is an agent and nobody has `signed_at`:

- Flag off → envelope stays `pending`; that attest returns `400 human_required`. No seal.
- Flag on → complete. Appearance + certificate banner: “No human electronic signature. Agent attestations only.”

Agent attest does **not** re-seal. Seal runs once on complete, as today.

**Vercel Flags** (`@vercel/flags`, dashboard). Server-side only. Tests: `SIGN_FLAG_AGENT_PARTIES` / `SIGN_FLAG_AGENT_ONLY_ATTEST` (`"1"` / `"true"` / `"0"`). Self-host: same env names; defaults match production defaults.

| Flag | Default | Effect |
|---|---|---|
| `agent_parties` | **on** once this slice ships | Creating `kind: agent`, agent registry, `attest` / `reject`, MCP agent tools |
| `agent_only_attest` | **off** | Complete with zero `signed_at` |

Decline/void: humans as today. Agent `POST …/reject` → `declined_at` on that party, envelope `declined`. Reminders email **human** parties only (with reprinted `/s/` URL).

---

## 6. Entitlement

No new Stripe Price.

| Capability | Free (incl. logged-in) | Pro / `SELF_HOST` |
|---|---|---|
| MCP OAuth to the **account** (`send` / `status` / `download`) | Yes | Yes |
| Live keys | Yes | Yes |
| Named agents, `sign_agent_`, grant→agent mapping | `403 pro_required` | Yes, **10** active agents per cabinet |
| `kind: agent`, `attest`, `reject`, agent webhooks | No | Yes |
| Packets | No | Yes (unchanged) |
| `verify` | Yes (no auth) | Yes |
| Zero-human complete | No | Only if `agent_only_attest` on |
| Send cap | 20/30d | Fair use |
| Appearance footer | “Sent with AgentSign” | Off |

Members of a Pro cabinet use the **owner’s** agent list (same as packets). Owner creates/revokes. Revoked agents do not count toward 10.

---

## 7. HTTP, MCP, OAuth routes

### Envelopes

`POST /v1/envelopes` `signers` array accepts `kind` + `agent` as in §3.

`GET /v1/envelopes/:id` includes `current_party` and per-party `kind`, `signed_at`, `attested_at`, `attest_method`.

### New REST

| Method | Path | Auth |
|---|---|---|
| `GET` | `/v1/agents` | Account. Pro. List owner-cabinet agents (no secrets). |
| `POST` | `/v1/agents` | Owner. Pro. Create; returns `sign_agent_` **once**. Optional `webhook_url`. |
| `POST` | `/v1/agents/:id/rotate` | Owner. New paste secret once. Old hash dead. |
| `PUT` | `/v1/agents/:id/webhook` | Owner. Set/clear URL; new HMAC secret shown once when URL set. |
| `DELETE` | `/v1/agents/:id` | Owner. Revoke. |
| `POST` | `/v1/envelopes/:id/attest` | Current party is an agent this caller may use. |
| `POST` | `/v1/envelopes/:id/reject` | Same, agent decline. |
| `POST` | `/v1/verify` | **None.** Sealed PDF bytes in. |

Packets unchanged. MCP wraps them for legal-mode “use packet NDA, fill Jane, send.”

### MCP tools (stdio + HTTP)

There is **no** `sign` tool.

| Tool | REST |
|---|---|
| `send` | `POST /v1/envelopes` (parties + `kind`) |
| `status` | `GET /v1/envelopes/:id` |
| `download` | `GET /v1/envelopes/:id.pdf` |
| `attest` | `POST …/attest` |
| `reject` | `POST …/reject` |
| `verify` | `POST /v1/verify` |
| `list_packets` | `GET /v1/packets` |
| `send_packet` | `POST /v1/packets/:id/send` |

Create/list agents: website + REST, not MCP.

### OAuth discovery

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `GET /oauth/authorize` (consent page)
- `POST /oauth/token`
- `POST /oauth/register` (DCR)
- HTTP MCP `POST /mcp` as today, with 401 challenge

---

## 8. Seal, certificate, verify

PKCS#12 ByteRange seal **once**, on complete. Sibling certificate as today, plus:

**Appearance page**

- Human: existing block.
- Agent: “Attested by {slug} for {principal email} at {UTC}. Not an electronic signature.”
- Zero-human complete (flag): banner on appearance **and** certificate.

**Certificate per party**

| Party | Fields |
|---|---|
| Human | name, email, sent/opened/consented/signed (or declined), IP, UA, auth: unique email link |
| Agent | name, slug, principal email, `attested_at` or `rejected_at`, auth: `agent_key:{prefix}` or `oauth:{client_name}`. No IP/UA theater. No consent checkbox. |

Envelope-level: `human_signatures: N`, `agent_attestations: M`. Consent sentence printed only if a human checked it.

Copy: agent attestation is a **cryptographic receipt**. ESIGN/UETA language only for human Finish. Do not say “AI signed,” “bot wet ink,” “court admissible,” QES.

**`POST /v1/verify`** (no auth): sealed PDF in.

- `valid` — ByteRange + our P12 holds
- `sha256`, `envelope_id`, `completed_at` if embedded
- `parties[]` as on the cert
- `human_signatures`, `agent_attestations`
- `valid: false` + `code` if not our seal

Verify does not need the database. `status` is the live record when the caller has a key.

---

## 9. Data

RLS on. Service-role only. Same as today.

**`agents`** — `id`, `owner_user_id`, `slug` (`[a-z0-9-]{1,40}`, unique per owner), `name`, `webhook_url`, `webhook_secret_hash` (AES-GCM, same KEK as envelope webhooks), `created_at`, `revoked_at`.

**`api_keys.kind`** gains `agent`. `agent_id` FK. Prefix `sign_agent_`.

**`signers`** (party list): `kind` `human | agent` default `human`; `agent_id` nullable; `attested_at`, `rejected_at`; `attest_method` `agent_key | oauth`; `attest_label`; `token_hash` nullable; **`token_enc`** (AES-GCM raw `/s/` token for humans, for reminder reprint).

**`oauth_clients`** — DCR/CIMD: `client_id`, `client_name`, `redirect_uris`, `auth_method`, `created_at`.

**`oauth_grants`** — `user_id`, `client_id`, `allowed_agent_ids` uuid[] (empty = cannot attest), access/refresh hashes, expiry, `revoked_at`.

**`oauth_codes`** — short-lived, PKCE S256, `resource`, chosen `allowed_agent_ids`.

Audit: `attested`, `rejected`.

---

## 10. UI

shadcn / Base UI. Behind `agent_parties` and Pro (Free: upgrade CTA, not a fake form).

- `/agents` — list, create slug+name, show `sign_agent_` once, rotate, revoke, optional webhook URL + show HMAC secret once. Owner writes; members see names they may attest as.
- `/oauth/authorize` — consent + mapping (§4).
- `/s/:token` — human parties only. Factual line if an earlier agent attested. Finish still requires the human checkbox.
- Cabinet envelope status — party list with kind, signed vs attested.
- OpenAPI + `/llms.txt` — parties, `attest` / `verify`, OAuth discovery, no `sign` tool, Free vs Pro, flags. Honest.

Homepage curl may show an A→H example. It is not an “AI signing” marketing page.

---

## 11. Also in this slice

### Reminder reprint

Encrypt the raw `/s/` token at rest (`token_enc`, same KEK as webhooks). `token_hash` stays for lookup. Day-3/6 reminders include the **same** URL. **Never remint** (that orphans the first email). Human parties only. Rows minted before this column (hash only, `token_enc` null) keep today’s copy: “Use the unique signing link we already sent you.”

### Free appearance footer

On seal, if cabinet is not entitled: small “Sent with AgentSign” on the **appearance page** only. Certificate has no ad. Pro / `SELF_HOST`: off.

### Per-agent inbound webhooks

Separate from the identity secret. Optional `webhook_url` + HMAC secret on the agent row (minted, sealed, shown once). Same SSRF denylist and HMAC as envelope webhooks.

Events when this agent is a party: `party.ready` (their turn), `envelope.completed`, `envelope.declined`, `envelope.expired`. Payload: no `/s/` tokens, no `sign_agent_` material, no webhook secrets.

Envelope-level `envelope.completed` is **unchanged**.

### Live cloud

Create:

1. Vercel project for this repo (Fluid Compute, Node, existing `vercel.ts` crons).
2. Supabase project (Auth + Postgres + Storage). Do not use Vercel Blob / `@vercel/postgres`.
3. Vercel Flags `agent_parties` and `agent_only_attest`.
4. Cloudflare DNS: `agentsign.co` apex + `www` → Vercel. `agentsign.net` → 301 to `agentsign.co`.

Env stays out of the repo. Tests stay PGlite + `setDeps` + flag env overrides. First production deploy is part of this slice so Flags Explorer can flip B.

---

## 12. Non-goals (filed as enhancements)

Not this spec:

- Field placer, `{{sig}}` tags, Sign drafting legal language — [#1](https://github.com/yohanmarshall/AgentSign/issues/1)
- `sign` MCP tool, auto-Finish, agent wet-ink appearance — [#2](https://github.com/yohanmarshall/AgentSign/issues/2)

Also not this spec: custom sending domain, certificate branding, seats, second Stripe Price, SSO/SAML, signup-to-sign, URL ingest, QES/SOC 2/HIPAA claims.

---

## 13. Testing

TDD. `setDeps` / `resetDeps`. `fileParallelism: false` remains.

Must include:

- Mixed A→H→A→H completes; certificate has attest + signed; `verify` valid
- A→A with flag off: last attest `400 human_required`; no seal
- A→A with flag on: completes; banner on cert; `human_signatures: 0`
- `sign_live_` cannot attest; `sign_agent_` attests only its slug
- OAuth grant without that agent in `allowed_agent_ids` → `403`
- Free `POST` with `kind: agent` → `403 pro_required`
- 11th named agent → `400` `{ code: "agent_limit" }`
- CIMD fetch to a blocked host → fail closed (reuse SSRF denylist)
- HTTP MCP 401 includes `resource_metadata`
- Reminder mail contains the original `/s/` URL; token hash unchanged
- Free seal appearance contains “Sent with AgentSign”; Pro does not
- Agent `party.ready` webhook HMAC verifies; envelope webhook still fires on complete
- `kind` omitted still creates a human party
- Concurrent last-human Finish vs agent attest: CAS, one winner

---

## 14. Suggested build order

1. Flags helper + env overrides (tests without Vercel).
2. Schema: agents, signer kind, token_enc, oauth tables, api_keys kind=agent.
3. `/v1/agents` + Pro gate + cap 10.
4. Send path accepts `kind: agent`; sequential current-party.
5. `attest` / `reject` + complete rules + flag B.
6. Seal/cert/verify + Free footer.
7. MCP tools + llms/OpenAPI.
8. OAuth discovery, PKCE, CIMD/DCR, consent mapping.
9. Reminder reprint; per-agent webhooks.
10. `/agents` + consent pages.
11. Copy rename Sign → AgentSign (UI, cert line, llms). Keys unchanged.
12. Create Vercel + Supabase + Cloudflare DNS + Flags in dashboard.

Do not create a `sign` tool in step 7.
