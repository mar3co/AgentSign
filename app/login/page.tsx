import { PageShell } from "@/components/page-shell";
import { safeNext } from "../../src/lib/safeNext.js";
import { LoginForm } from "./login-form";

export const runtime = "nodejs";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ email?: string; next?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  return (
    <PageShell variant="auth">
      <LoginForm email={sp.email ?? ""} next={safeNext(sp.next)} />
    </PageShell>
  );
}
