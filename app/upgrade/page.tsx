import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";
import { PRICING_BLOCK } from "@/components/marketing/pricing-block";
import { TerminalPanel } from "@/components/marketing/terminal-panel";
import { TwoReader } from "@/components/marketing/two-reader";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Upgrade",
};

const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.22em] text-tint";

export default function UpgradePage() {
  return (
    <PageShell variant="public" width="full">
      <TwoReader
        human={
          <>
            <p className={EYEBROW}>One flat price</p>
            <h1 className="font-heading text-4xl leading-[1.14] tracking-[-0.02em] text-pretty md:text-5xl">
              Keep the file a year
              <span className="text-seal">.</span>
            </h1>
            <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
              Free is the fax: send, sign, shred. Pro is the cabinet.
            </p>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Free</CardTitle>
                  <CardDescription>
                    No account to send or finish.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                    <li>Sealed PDF plus a sibling certificate.</li>
                    <li>We keep completed files 7 days, then shred them.</li>
                    <li>Quiet cap on send volume. Live keys after login.</li>
                  </ul>
                </CardContent>
              </Card>
              <Card className="ring-foreground/20">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>Pro</CardTitle>
                    <Badge variant="outline">$19/mo</Badge>
                  </div>
                  <CardDescription>
                    One price. Keep the file a year.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                    <li>Keep completed envelopes a year.</li>
                    <li>Shop name and logo on mail and the signing page.</li>
                    <li>Saved packets, cabinet invites, named agents.</li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <form
                    action="/upgrade/checkout"
                    method="POST"
                    className="w-full"
                  >
                    <Button
                      className="h-11 w-full bg-seal text-base text-bond hover:bg-seal/90"
                      type="submit"
                    >
                      Keep this a year
                    </Button>
                  </form>
                </CardFooter>
              </Card>
            </div>
          </>
        }
        machine={
          <TerminalPanel
            eyebrow="Pricing as data"
            footer={
              <p className="text-[#7e97d8]">
                No seats. No per-document fees. Cancel any time.
              </p>
            }
          >
            <pre className="overflow-x-auto whitespace-pre text-ledger">
              {PRICING_BLOCK}
            </pre>
          </TerminalPanel>
        }
      />
    </PageShell>
  );
}
