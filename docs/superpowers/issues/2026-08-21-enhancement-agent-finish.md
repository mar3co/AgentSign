# Enhancement: Agent Finish (`sign` MCP, auto-Finish, wet-ink appearance)

**Status:** Open. Not in the v1.2 agent-parties spec.  
**GitHub:** https://github.com/yohanmarshall/AgentSign/issues/2  
**Type:** Enhancement  
**Filed:** 2026-08-21  
**Blocked by:** Locked model — humans Finish (ESIGN), agents Attest (`attested_at`, never `signed_at`). A `sign` tool and auto-Finish would make the certificate lie.

## Why it exists

Asked for during agent-flow design, then explicitly deferred (option 1). v1.2 ships **attest** as a cryptographic receipt that a named official agent accepted the bytes. It does not ship bots as signers.

## Wanted (when we choose to)

1. **`sign` MCP tool** — a bot completes a party the way a human does today.
2. **Auto-Finish** — a key or OAuth grant completes without a human at `/s/:token`.
3. **Agent wet-ink appearance** — bot-drawn / bot-styled signature graphic on the appended page.

## Constraints if this is ever picked up

- Must be a **new verb or a flag**, not a silent reuse of `signed_at`.
- Certificate and `verify` must still distinguish ESIGN from machine completion. If we call it a signature, counsel has to rewrite the ESIGN/UETA copy.
- Default remains: keys authenticate the caller and do not Finish a human party.
- `agent_only_attest` (zero-human complete) is a Vercel flag in v1.2; this issue is the further step where a bot **signs**, not only attests.
- No signup-to-sign.

## Out of scope here

Named agents, account OAuth, grant→agent mapping, `attest` / `reject` / `verify`, per-agent inbound webhooks — v1.2.
