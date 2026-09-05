# Name

**OpenSeal** (one word, CamelCase). Renamed from AgentSign on 2026-09-03.

Repo: [mar3co/openseal](https://github.com/mar3co/openseal).
Canonical host: **https://openseal.me**.
Alias: **agentsign.co** stays attached to the same Vercel project and serves the same app,
permanently. It is **not** a 301. A permanent redirect on an API host is unsafe: many HTTP
clients turn POST into GET or drop the body when they follow a 301, so redirecting
`agentsign.co/v1/...` would break the very integrations the redirect is meant to protect. API
base URLs live in other people's code and never fully migrate, so the old host keeps answering
on its own. `openseal.me` is canonical for humans and search engines through `metadataBase`,
which is where a canonical belongs.

**agentsign.net** has no DNS records at all — the "→ 301" this file used to claim was never
configured, and the domain has never resolved. Either point it at the app or let it lapse; do
not keep documenting a redirect that does not exist.
DNS: Cloudflare, MAR3 Technologies.

The product is unchanged: a signing primitive (send / sign / fetch). Humans Finish. Agents
Attest. An agent is a machine acting for a named human principal.

## Why the change

AgentSign named the caller. OpenSeal names the artifact, which is the thing that outlives any
one integration — and it already described the identity: the mark has been a pen over four
pixels with a wax seal on the last one since 2026-08-23, and the favicon is a wax tile. See
[Brand.md](../Brand.md).

"Open" is a claim the repo can support — public, AGPL-3.0, and `SELF_HOST=1` entitles the Pro
extras without a plan. Keep it true.

## Form

**Casing:** the product is **OpenSeal** in CamelCase wherever a human reads it — UI, wordmark,
invoices, the certificate product line. Every machine identifier is lowercase `openseal`: the
GitHub repo, the local folder, the host, the MCP server name. That matches the rest of the MAR3
workspace, where repos are lowercase (`ss-core`, `ss-macos`, `opentag`, `all-good`) and
AgentSign was the outlier.

| Place | Form |
|---|---|
| Spoken / invoices / certificate product line | **OpenSeal** |
| GitHub | `mar3co/openseal` |
| Local folder | `~/GitHub/MAR3/openseal` |
| Hosted product | `openseal.me` |
| npm `package.json` `name` | stays `sign` — brand-neutral, no reason to churn |
| MCP bin | stays `sign-mcp` |
| Key prefixes | `sign_tmp_` / `sign_live_` / `sign_agent_` / `sign_oauth_` — **never change**, they are in customer config and hashed in the database |

## Domain

`openseal.me` was registered 2026-09-03 through Cloudflare, in the same account as the
agentsign zones. It was the available choice: `openseal.com`, `.co`, `.io`, `.dev`, `.app`,
`.ai`, `.org` and `.net` are all registered to other parties.

`openseal.co` is parked (Dynadot, Cloudflare DNS, no A record) and may be purchasable later.
The host lives in `APP_URL`, so an upgrade costs no code — but it would cost a reissued signing
certificate and a re-warmed sending domain, so decide before those are provisioned, not after.

## What the rename could not rewrite

Documents already sealed as AgentSign carry the old name in their signature dictionary, PDF
Producer/Creator metadata, and the Free-tier appearance footer. They are cryptographically
sealed and cannot be rewritten. Verification does not read the product name out of a PDF, so
**they keep verifying** — the mixed history is cosmetic and permanent.

**Passkeys do not survive the host move.** WebAuthn credentials are bound to the relying-party
id, which is the host, so every passkey registered against `agentsign.co` stops working once
the canonical host is `openseal.me`. It is not a lockout — magic link, password and the social
providers still work — but affected users must re-enroll. This is a second reason to settle
`openseal.me` vs a later `openseal.co` *before* the cutover rather than after: moving the host
twice means asking people to re-enroll twice.

**The embed `postMessage` source stays `"agentsign"`.** It is a protocol constant sitting in
embedders' message handlers, the same category as the `sign_` key prefixes. Renaming it would
break every embedder that filters on it, and emitting both values would double-fire the
completion path for every embedder that does not.

Dated plans and specs under `docs/superpowers/` and `docs/2026-08-19-product-plan.md` are left
in the old name on purpose. They record what was built and when; rewriting them would falsify
the record.

## History

- Earlier notes preferred "Secure Sign" and rejected AgentSign as too specific. Overridden
  2026-08-21.
- **AgentSign → OpenSeal, 2026-09-03.** OpenSign remains taken. Do not ship as Secure Sign.

This file has now settled two names. Treat a third as a real cost, not a free decision: the
rename touched 57 files and seven surfaces outside the repo.
