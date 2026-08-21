import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const runtime = "nodejs";

export default function UpgradePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <p className="text-base font-medium">AgentSign</p>
        <a className="text-sm text-muted-foreground underline" href="/">
          Send a PDF
        </a>
      </header>
      <main className="flex flex-1 flex-col">
        <Card>
          <CardHeader>
            <CardTitle>Keep this a year</CardTitle>
            <CardDescription>
              Pro keeps completed envelopes for a year. $19/mo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/upgrade/checkout" method="POST" className="flex flex-col gap-4">
              <Button className="h-11 w-full text-base" type="submit">
                Keep this a year
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
      <footer className="pb-4 text-center text-sm text-muted-foreground">
        AgentSign
      </footer>
    </div>
  );
}
