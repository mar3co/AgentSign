"use client";

import { useEffect, useState } from "react";
import { LoadingList } from "@/components/loading-list";
import { SettingsSection } from "@/components/settings-shell";
import { LinkButton } from "@/components/link-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function AccountClient() {
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/auth/whoami", { credentials: "include" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/settings")}`;
          return;
        }
        const json = (await res.json().catch(() => null)) as {
          email?: string;
          error?: string;
        } | null;
        if (!res.ok || !json?.email) {
          if (!cancelled) setError(json?.error ?? "Could not load your account.");
          return;
        }
        if (!cancelled) setEmail(json.email);
      } catch {
        if (!cancelled) setError("Could not load your account.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!email) return <LoadingList />;

  return (
    <>
      <SettingsSection
        title="Email"
        description="Your login identity. Documents you send are tied to this address."
      >
        <Card>
          <CardContent className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} disabled readOnly />
          </CardContent>
        </Card>
      </SettingsSection>
      <Separator className="my-10" />
      <SettingsSection
        title="Sign-in"
        description="Password, magic link, Google, GitHub, or a passkey."
      >
        <Card>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              You sign in with this email. Passkeys are on the Security tab.
            </p>
            <LinkButton href="/settings/security" variant="outline" className="self-start">
              Passkeys
            </LinkButton>
          </CardContent>
        </Card>
      </SettingsSection>
    </>
  );
}
