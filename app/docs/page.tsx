import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { TerminalPanel } from "@/components/marketing/terminal-panel";
import { TwoReader } from "@/components/marketing/two-reader";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Docs",
};

const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.22em] text-tint";

const SEND_BLOCK = `$ curl -F title='Repair authorization' \\
       -F sender_email=you@example.com \\
       -F signers='[{"name":"Jane",
         "email":"jane@example.com"}]' \\
       -F file=@form.pdf \\
       https://agentsign.co/v1/envelopes
{ "id": "env_kx3q9", "status": "sent" }`;

const STATUS_BLOCK = `$ curl https://agentsign.co/v1/envelopes/env_kx3q9 \\
       -H 'authorization: Bearer sign_live_...'
{ "status": "completed", "signers": [ … ], "audit": [ … ] }`;

const VERIFY_BLOCK = `$ curl -F file=@sealed.pdf \\
       https://agentsign.co/v1/verify
{ "valid": true, "human_signatures": 1, "agent_attestations": 1 }`;

export default function DocsPage() {
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
              Everything here speaks plain HTTP. Send a PDF with one request.
              No key needed: we email you a one-time code and hand back a
              throwaway key for that envelope. Log in to mint live keys.
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
            </div>
          </>
        }
        machine={
          <TerminalPanel eyebrow="Send" address="POST /v1/envelopes">
            <pre className="overflow-x-auto whitespace-pre text-ledger">
              {SEND_BLOCK}
            </pre>
          </TerminalPanel>
        }
      />

      <TwoReader
        human={
          <>
            <h2 className="font-heading text-2xl tracking-[-0.01em] md:text-3xl">
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
                follows one envelope: status and download only. It cannot
                send. You get one when you send without logging in.
              </p>
              <p>
                <code className="font-mono text-sm text-foreground">
                  sign_agent_
                </code>{" "}
                names an agent. It signs off on its turn and gets a
                cryptographic receipt, not a pretend signature. It never
                signs for a person.
              </p>
            </div>
          </>
        }
        machine={
          <TerminalPanel eyebrow="Status" address="GET /v1/envelopes/{id}">
            <pre className="overflow-x-auto whitespace-pre text-ledger">
              {STATUS_BLOCK}
            </pre>
          </TerminalPanel>
        }
      />

      <TwoReader
        human={
          <>
            <h2 className="font-heading text-2xl tracking-[-0.01em] md:text-3xl">
              Verify
            </h2>
            <p className="max-w-prose text-[15px] leading-relaxed text-muted-foreground">
              Anyone can POST a sealed file back and get the verdict: valid
              or not, plus how many people signed and how many agents signed
              off. No key, no account. The file is the proof.
            </p>
          </>
        }
        machine={
          <TerminalPanel eyebrow="Verify" address="POST /v1/verify">
            <pre className="overflow-x-auto whitespace-pre text-ledger">
              {VERIFY_BLOCK}
            </pre>
          </TerminalPanel>
        }
      />
    </PageShell>
  );
}
