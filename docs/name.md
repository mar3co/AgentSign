# Name

Not shipped. Folder working title: **Sign**.

The [product plan](./2026-08-19-product-plan.md) is **its own product**. Not a suite SKU. Do not put a suite subdomain or catalog copy in the product until that header is changed on purpose.

**Secure Sign** below is a *name candidate*, not a decision that the app lives under another product.

## Constraints

- Short enough to say on a phone: “I’ll send it through ___.”
- Fits a person sending a PDF *and* a `curl` / agent user.
- `.com` / `.dev` / `.so` worth checking before we fall in love.
- Avoid collisions: OpenSign, DocuSign, HelloSign, SignNow, DocuSeal, Secured Signing, MRI Secure Sign.

## The three you named

**OpenSign — taken.** OpenSign Labs is already the OSS DocuSign alternative. You would be “the other OpenSign” forever.

**AgentSign — too specific.** Do not.

- Agents are one surface (MCP, three tools). Paying v1 users are people sending a PDF.
- “Agent” also means insurance / real estate / talent agent. A sender will hear the wrong thing, or nothing.
- Signbee and SendSign already occupy “e-sign for agents.” Naming ourselves that is their category, not ours.
- Fine as a *feature line* (“works with agents”) on the homepage. Bad as the name on the certificate someone forwards.

**Secure Sign — best of the three.** Use it.

- Trust is the job; clever is not.
- A receptionist can say it. A lawyer can say it. It can go on an invoice.

Downsides to accept, not ignore:

- Generic. “Secure sign” is a phrase, not a brand. SEO is a swamp.
- Close names already exist: [Secured Signing](https://www.securedsigning.com/) (RON + digital signatures), MRI **Secure Sign** (real estate). You will not own the search term.
- Does not advertise “no account / 7-day shredder / instant key.” That is homepage copy, not the name.

Generic names are acceptable. The product does not live in a suite catalog.

## How to use it

Only if we later *choose* the Secure Sign name. Key prefixes in the product plan are `sign_tmp_…` / `sign_live_…`, not `ssign_`. Hosted product is a Vercel app on its own domain.

| Place | Form |
|---|---|
| Spoken / invoices | **Secure Sign** (two words, if we pick this name) |
| Repo / package | still `sign` until a rename pass |
| Hosted product | own domain |

You do **not** need a second consumer name for v1. One name, one cloud.

## If Secure Sign feels too dull later

Only switch if the public/OSS story needs a word people can own. Same product, new coat.

| Name | Why it fits | Risk |
|---|---|---|
| **Signet** | A seal. Short. Matches “stamp + keep.” | Some company/bank collisions |
| **Kept** | Retention *is* the meter | Sounds like a notes app |
| **Attest** | What the certificate does | Formal, slightly legal-tech |
| **Endorse** | Insurance-check energy | Banking/check-cashing vibe |
| **Witness** | Audit trail | Court / notary confusion |

Do not spend a week here. Ship as Secure Sign.

When this is final, replace “Sign” in `README.md` and `docs/2026-08-19-product-plan.md` in one pass.
