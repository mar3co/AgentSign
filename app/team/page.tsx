import { TeamClient } from "./team-client";

export const runtime = "nodejs";

export default function TeamPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <p className="text-base font-medium">AgentSign</p>
        <a className="text-sm text-muted-foreground underline" href="/envelopes">
          Cabinet
        </a>
      </header>
      <main className="flex flex-1 flex-col">
        <TeamClient />
      </main>
      <footer className="pb-4 text-center text-sm text-muted-foreground">
        AgentSign
      </footer>
    </div>
  );
}
