# Enhancement: Field placer, `{{sig}}` tags, drafted legal language

**Status:** Partially shipped. PDF tags and on-page fields JSON are in the on-page-fields slice. Drag-drop placer and drafting remain parked.  
**GitHub:** https://github.com/yohanmarshall/AgentSign/issues/1  
**Type:** Enhancement  
**Filed:** 2026-08-21  
**Blocked by:** Product thesis (signing primitive, no suite). Placer still deferred so we do not become DocuSeal in the agent slice.

## Why it exists

Asked for during agent-flow design. Parking the placer keeps send/sign/fetch + official-agent **attest** honest. Building a drag-drop document platform is a different product.

## Shipped (on-page fields)

1. **`{{sig}}` / `{{date}}` / `{{name}}` tags** in the uploaded PDF — Free one-offs and create/templates accept them; coordinates become `DocumentField[]`.
2. **Fields JSON** on create/send (`fields`, `values`, `order`, `send_email`, `embed_origin`, `completed_redirect_url`) plus ceremony overlay, burn, and MCP/OpenAPI/llms surface. Still no `sign` tool.

## Still parked

1. **Drag-drop field placer** — not on the current roadmap; DocuSeal gravity. A future placer should write `DocumentField[]` only (one coordinate system).
2. **Drafting legal language** — Sign (or an agent using Sign) writes the customer’s form. Today we refuse: customer’s lawyer’s PDF, repair-auth examples only. No statutory POA marketing.

## Constraints if the placer is ever picked up

- Human Finish remains the only ESIGN step unless a later spec reopens agent-Finish.
- Do not require signup-to-sign.
- Certificate stays factual; do not brand the seal as legal advice.
- Still no second SKU unless this is clearly the reason for one.
- Apache-2.0; do not vendor AGPL placer code.

## Out of scope here

Agent attest, MCP OAuth, named agents, `verify`, reminder reprint, Free footer, per-agent webhooks, Vercel Flags — those live in the v1.2 / on-page-fields specs.
