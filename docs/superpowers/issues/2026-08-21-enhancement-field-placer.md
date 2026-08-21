# Enhancement: Field placer, `{{sig}}` tags, drafted legal language

**Status:** Open. Not in the v1.2 agent-parties spec.  
**GitHub:** https://github.com/yohanmarshall/AgentSign/issues/1  
**Type:** Enhancement  
**Filed:** 2026-08-21  
**Blocked by:** Product thesis (signing primitive, no suite). Explicitly deferred so we do not become DocuSeal in the agent slice.

## Why it exists

Asked for during agent-flow design. Parking it keeps send/sign/fetch + official-agent **attest** honest. Building this is a different product: a document platform.

## Wanted (when we choose to)

1. **`{{sig}}` / `{{date}}` / `{{name}}` tags** in the uploaded PDF — on-ramp the product plan already named as “later, only if the extra signature page looks cheap.”
2. **Drag-drop field placer** — not on the current roadmap; DocuSeal gravity.
3. **Drafting legal language** — Sign (or an agent using Sign) writes the customer’s form. Today we refuse: customer’s lawyer’s PDF, repair-auth examples only. No statutory POA marketing.

## Constraints if this is ever picked up

- Human Finish remains the only ESIGN step unless a later spec reopens agent-Finish.
- Do not require signup-to-sign.
- Certificate stays factual; do not brand the seal as legal advice.
- Still no second SKU unless this is clearly the reason for one.
- Apache-2.0; do not vendor AGPL placer code.

## Out of scope here

Agent attest, MCP OAuth, named agents, `verify`, reminder reprint, Free footer, per-agent webhooks, Vercel Flags — those live in the v1.2 spec.
