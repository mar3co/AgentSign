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

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Upgrade",
};

export default function UpgradePage() {
  return (
    <PageShell variant="public" width="lg">
      <section className="flex flex-col gap-3">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
          one price
        </p>
        <h1 className="font-heading text-4xl leading-[0.95] tracking-tight">
          Keep the file a year.
        </h1>
        <p className="max-w-prose text-base text-muted-foreground">
          Free is the fax: send, sign, shred. Pro is the cabinet.
        </p>
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Free</CardTitle>
            <CardDescription>No account to send or finish.</CardDescription>
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
            <CardDescription>One price. Keep the file a year.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li>Keep completed envelopes a year.</li>
              <li>Shop name and logo on mail and the signing page.</li>
              <li>Saved packets, cabinet invites, named agents.</li>
            </ul>
          </CardContent>
          <CardFooter>
            <form action="/upgrade/checkout" method="POST" className="w-full">
              <Button className="h-11 w-full text-base" type="submit">
                Keep this a year
              </Button>
            </form>
          </CardFooter>
        </Card>
      </div>
    </PageShell>
  );
}
