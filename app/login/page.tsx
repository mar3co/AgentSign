import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { safeNext } from "../../src/lib/safeNext.js";
import { AgentAside } from "./agent-aside";
import { LoginForm } from "./login-form";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Log in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ email?: string; next?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  return (
    <PageShell variant="auth">
      <section className="flex flex-col gap-3">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
          same account
        </p>
        <h1 className="font-heading text-4xl leading-[0.95] tracking-tight">
          Log in<span className="text-seal">.</span>
        </h1>
        <p className="text-base text-muted-foreground">
          Magic link, password, passkey, or Google / GitHub.
        </p>
      </section>
      <LoginForm email={sp.email ?? ""} next={safeNext(sp.next)} />
      <AgentAside />
    </PageShell>
  );
}
