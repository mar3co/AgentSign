import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { TerminalPanel } from "@/components/marketing/terminal-panel";
import { TwoReader } from "@/components/marketing/two-reader";
import { appOrigin } from "@/src/env";

export const runtime = "nodejs";
// Read APP_URL per request, not at build, so self-host images that supply
// env at runtime print the real MCP URL.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Docs",
};

const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.22em] text-tint";
const HEADING =
  "scroll-mt-24 font-heading text-2xl tracking-[-0.01em] md:text-3xl";
const CODE = "font-mono text-sm text-foreground";

const SEND_BLOCK = `$ curl -F title='Repair authorization' \\
       -F sender_email=you@example.com \\
       -F signers='[{"name":"Jane",
         "email":"jane@example.com"}]' \\
       -F file=@form.pdf \\
       https://openseal.me/v1/documents
{ "id": "doc_kx3q9", "status": "sent" }`;

const STATUS_BLOCK = `$ curl https://openseal.me/v1/documents/doc_kx3q9 \\
       -H 'authorization: Bearer sign_live_...'
{ "status": "completed", "signers": [ … ], "audit": [ … ] }`;

const VERIFY_BLOCK = `$ curl -F file=@sealed.pdf \\
       https://openseal.me/v1/verify
{ "valid": true, "human_signatures": 1, "agent_attestations": 1 }`;

const EMBED_BLOCK = `<iframe src="https://openseal.me/s/TOKEN"></iframe>
// listen for { source: "openseal", event }
// optional: embed_origin, send_email=false, fields JSON, PDF {{sig}}`;

function mcpBlock(origin: string): string {
  return `# Claude Code
$ claude mcp add --transport http openseal \\
       ${origin}/mcp

# Cursor (mcp.json)
{ "mcpServers": { "openseal": {
    "url": "${origin}/mcp" } } }

# Claude Desktop, claude.ai
Settings > Connectors > Add custom connector
URL: ${origin}/mcp

# No MCP host? Speak it yourself.
$ curl -X POST ${origin}/mcp \\
       -H 'authorization: Bearer sign_live_...' \\
       -H 'accept: application/json, text/event-stream' \\
       -H 'content-type: application/json' \\
       -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
         "params":{"protocolVersion":"2025-11-25",
         "capabilities":{},"clientInfo":
         {"name":"curl","version":"1"}}}'`;
}

function agentBlock(origin: string): string {
  return `$ curl -X POST \\
       ${origin}/v1/documents/doc_kx3q9/attest \\
       -H 'authorization: Bearer sign_agent_...'
{ "status": "pending" }

# webhook POST to your agent URL
# X-Sign-Timestamp: 1756000000
# X-Sign-Signature: sha256=hmac(secret, "timestamp.body")
{ "event": "party.ready", "id": "doc_kx3q9",
  "agent": "claude-ops", "status": "pending" }`;
}

const ERROR_CODES: readonly { code: string; meaning: string }[] = [
  {
    code: "human_required",
    meaning:
      "Every party attested and nobody signed. A document needs a human signer, so add one when sending.",
  },
  {
    code: "invalid_state",
    meaning: "The document is not awaiting attestation: already complete, declined, or expired.",
  },
  {
    code: "cannot_attest",
    meaning:
      "This caller may not attest as that agent, or it is not that agent's turn.",
  },
  {
    code: "unknown_agent",
    meaning: "A signer named an agent slug that does not exist on this team.",
  },
  { code: "agent_limit", meaning: "Ten agents per team." },
  {
    code: "pro_required",
    meaning: "Agent parties need Pro. Self-host is entitled.",
  },
  {
    code: "flag_off",
    meaning: "Agent parties are switched off on this deployment.",
  },
  {
    code: "invalid_request",
    meaning:
      "An agent party's email didn't match the agent owner's account, or the request was otherwise malformed.",
  },
  {
    code: "slug_taken",
    meaning: "That agent slug is already registered on this team.",
  },
];

export default function DocsPage() {
  const origin = appOrigin();
  return (
    <PageShell variant="public" width="full">
      <TwoReader
        human={
          <>
            <p className={EYEBROW}>The manual</p>
            <h1 className="font-heading text-4xl leading-[1.14] tracking-[-0.02em] text-pretty md:text-5xl">
              Docs<span className="text-seal">.</span>
            </h1>
            <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
              Everything here speaks plain HTTP. Send a document with one
              request.
              No key needed: we email you a one-time code and hand back a
              throwaway key for that document. Log in to mint live keys.
              On-page fields use PDF tags or fields JSON; there is no placer
              and no sign tool.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                className="text-sm font-medium text-tint underline-offset-4 hover:underline"
                href="/openapi.json"
              >
                OpenAPI schema &rarr;
              </a>
              <span aria-hidden className="text-input">
                &middot;
              </span>
              <a
                className="text-sm font-medium text-tint underline-offset-4 hover:underline"
                href="/llms.txt"
              >
                llms.txt for your agent &rarr;
              </a>
              <span aria-hidden className="text-input">
                &middot;
              </span>
              <a
                className="text-sm font-medium text-tint underline-offset-4 hover:underline"
                href="#mcp"
              >
                Connect over MCP &rarr;
              </a>
            </div>
          </>
        }
        machine={
          <TerminalPanel eyebrow="Send" address="POST /v1/documents">
            <pre className="overflow-x-auto whitespace-pre">
              {SEND_BLOCK}
            </pre>
          </TerminalPanel>
        }
      />

      <TwoReader
        human={
          <>
            <h2 className={HEADING}>
              Keys
            </h2>
            <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                <code className="font-mono text-sm text-foreground">
                  sign_live_
                </code>{" "}
                sends, lists, and downloads. Mint one after you log in.
              </p>
              <p>
                <code className="font-mono text-sm text-foreground">
                  sign_tmp_
                </code>{" "}
                follows one document: status and download only. It cannot
                send. You get one when you send without logging in.
              </p>
              <p>
                <code className="font-mono text-sm text-foreground">
                  sign_agent_
                </code>{" "}
                names an agent. It attests on its turn and gets a
                cryptographic receipt, not a pretend signature. It never
                signs for a person.
              </p>
            </div>
          </>
        }
        machine={
          <TerminalPanel eyebrow="Status" address="GET /v1/documents/{id}">
            <pre className="overflow-x-auto whitespace-pre">
              {STATUS_BLOCK}
            </pre>
          </TerminalPanel>
        }
      />

      <TwoReader
        human={
          <>
            <h2 className={HEADING} id="mcp">
              MCP
            </h2>
            <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                The same surface over MCP, at{" "}
                <code className={CODE}>{origin}/mcp</code>. Streamable HTTP,
                one endpoint, no gateway to install.
              </p>
              <p>
                Hosts that speak OAuth only need that URL: we publish{" "}
                <code className={CODE}>
                  /.well-known/oauth-protected-resource
                </code>{" "}
                and{" "}
                <code className={CODE}>
                  /.well-known/oauth-authorization-server
                </code>
                , register the client at{" "}
                <code className={CODE}>/oauth/register</code>, and run OAuth
                2.1 with PKCE (S256). An unauthenticated call answers 401 with
                that metadata, so the host finds the rest on its own. Hosts
                that take a secret instead can pass a key as{" "}
                <code className={CODE}>authorization: Bearer sign_live_</code>{" "}
                and skip OAuth.
              </p>
              <ul className="flex flex-col gap-1.5">
                <li>
                  <code className={CODE}>send</code> creates and sends a
                  document, markdown or PDF bytes.
                </li>
                <li>
                  <code className={CODE}>status</code> reports where a document
                  stands, party by party.
                </li>
                <li>
                  <code className={CODE}>download</code> returns the sealed
                  PDF.
                </li>
                <li>
                  <code className={CODE}>attest</code> takes an agent party&rsquo;s
                  turn.
                </li>
                <li>
                  <code className={CODE}>reject</code> declines it and stops the
                  document.
                </li>
                <li>
                  <code className={CODE}>verify</code> checks a sealed file. No
                  key on the REST endpoint.
                </li>
                <li>
                  <code className={CODE}>list_templates</code> lists your saved
                  templates.
                </li>
                <li>
                  <code className={CODE}>send_template</code> sends one, signers
                  in role order.
                </li>
              </ul>
              <p>
                There is no <code className={CODE}>sign</code> tool, and there
                will not be one. A key says who is calling; it never stands in
                for a person. Humans finish, agents attest.
              </p>
            </div>
          </>
        }
        machine={
          <TerminalPanel eyebrow="MCP" address="POST /mcp">
            <pre className="overflow-x-auto whitespace-pre">
              {mcpBlock(origin)}
            </pre>
          </TerminalPanel>
        }
      />

      <TwoReader
        human={
          <>
            <h2 className={HEADING} id="agents">
              Agents
            </h2>
            <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                An agent party is a party on the document with{" "}
                <code className={CODE}>kind: agent</code> and a slug you
                registered at{" "}
                <a
                  className="text-tint underline-offset-4 hover:underline"
                  href="/agents"
                >
                  /agents
                </a>
                . It gets no signing link and no ceremony. When its turn comes it attests or
                rejects over the API, and the receipt names the agent and the
                person it acted for. An agent party carries the account
                owner&rsquo;s email address; give it any other email and the
                send is rejected.
              </p>
              <p>
                A <code className={CODE}>sign_agent_</code> key attests and
                rejects, for its own agent and nothing else. A{" "}
                <code className={CODE}>sign_live_</code> key, a session, or an
                OAuth grant attests by naming an agent the team owns. Sending
                needs a live key, a session, or an OAuth grant.
              </p>
              <p>
                Each agent can carry a webhook URL. We POST{" "}
                <code className={CODE}>party.ready</code>,{" "}
                <code className={CODE}>document.completed</code>,{" "}
                <code className={CODE}>document.declined</code>, and{" "}
                <code className={CODE}>document.expired</code> to it, signed
                with <code className={CODE}>X-Sign-Signature</code> (
                <code className={CODE}>sha256=</code> HMAC of{" "}
                <code className={CODE}>timestamp.body</code>) and{" "}
                <code className={CODE}>X-Sign-Timestamp</code>. The secret is
                shown once, when you set the URL.
              </p>
              <p>
                A send from an OAuth grant is held at{" "}
                <code className={CODE}>pending_sender</code> until you enter the
                code we email you. Turn that off under{" "}
                <a
                  className="text-tint underline-offset-4 hover:underline"
                  href="/settings/security"
                >
                  Settings, Security, Send confirmation
                </a>
                . Live keys are standing authorizations and always send at
                once.
              </p>
              <dl className="flex flex-col gap-2">
                {ERROR_CODES.map((row) => (
                  <div key={row.code} className="flex flex-col gap-0.5">
                    <dt className={CODE}>{row.code}</dt>
                    <dd>{row.meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </>
        }
        machine={
          <TerminalPanel
            eyebrow="Attest"
            address="POST /v1/documents/{id}/attest"
          >
            <pre className="overflow-x-auto whitespace-pre">
              {agentBlock(origin)}
            </pre>
          </TerminalPanel>
        }
      />

      <TwoReader
        human={
          <>
            <h2 className={HEADING}>
              Verify
            </h2>
            <p className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
              Anyone can POST a sealed file back and get the verdict: valid
              or not, plus how many people signed and how many agents
              attested. No key, no account. The file is the proof.
            </p>
          </>
        }
        machine={
          <TerminalPanel eyebrow="Verify" address="POST /v1/verify">
            <pre className="overflow-x-auto whitespace-pre">
              {VERIFY_BLOCK}
            </pre>
          </TerminalPanel>
        }
      />

      <TwoReader
        human={
          <>
            <h2 className={HEADING}>
              Embed
            </h2>
            <p className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
              Iframe the ceremony at{" "}
              <code className="font-mono text-sm text-foreground">/s/:token</code>
              . Set{" "}
              <code className="font-mono text-sm text-foreground">
                embed_origin
              </code>{" "}
              and listen for{" "}
              <code className="font-mono text-sm text-foreground">
                postMessage
              </code>
              . Use{" "}
              <code className="font-mono text-sm text-foreground">
                send_email=false
              </code>{" "}
              when you deliver the link yourself. Tags and fields JSON place
              signatures; we do not ship a placer.
            </p>
          </>
        }
        machine={
          <TerminalPanel eyebrow="Embed" address="GET /s/{token}">
            <pre className="overflow-x-auto whitespace-pre">
              {EMBED_BLOCK}
            </pre>
          </TerminalPanel>
        }
      />
    </PageShell>
  );
}
