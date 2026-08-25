"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { LoadingList } from "@/components/loading-list";
import { SettingsSection } from "@/components/settings-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

type UsageMeter = { used: number; limit: number | null; window_days?: number };

type Billing = {
  plan: "free" | "pro";
  entitled: boolean;
  role: "owner" | "member";
  current_period_end: string | null;
  usage: {
    sends: UsageMeter;
    seats: UsageMeter;
    templates: UsageMeter;
    agents: UsageMeter;
  };
  payment_method: { brand: string; last4: string } | null;
  domain: { hostname: string | null; verified: boolean; cname_target: string };
};

function meterLabel(meter: UsageMeter): string {
  if (meter.limit == null) return `${meter.used} in the last ${meter.window_days ?? 30} days`;
  return `${meter.used} / ${meter.limit}`;
}

function Meter({ label, meter }: { label: string; meter: UsageMeter }) {
  const cap = meter.limit ?? Math.max(meter.used, 1);
  const pct = meter.limit == null ? 0 : Math.min(100, Math.round((meter.used / cap) * 100));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">{meterLabel(meter)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function BillingClient() {
  const [state, setState] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostname, setHostname] = useState("");
  const [domainMsg, setDomainMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/v1/billing", { credentials: "include" });
        if (res.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent("/settings/billing")}`;
          return;
        }
        const json = (await res.json().catch(() => null)) as
          | (Billing & { error?: string })
          | null;
        if (!res.ok || !json?.usage) {
          if (!cancelled) setError(json?.error ?? "Could not load billing.");
          return;
        }
        if (!cancelled) {
          setState(json);
          setHostname(json.domain.hostname ?? "");
        }
      } catch {
        if (!cancelled) setError("Could not load billing.");
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

  if (!state) return <LoadingList />;

  const canEdit = state.role === "owner";

  async function onSaveDomain(e: FormEvent) {
    e.preventDefault();
    setDomainMsg(null);
    const res = await fetch("/v1/billing/domain", {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostname }),
    });
    const json = (await res.json().catch(() => null)) as
      | Billing["domain"] & { error?: string }
      | null;
    if (!res.ok) {
      setDomainMsg(json?.error ?? "Could not save domain.");
      return;
    }
    setState((prev) => (prev && json ? { ...prev, domain: json } : prev));
    setDomainMsg("Saved. Point a CNAME at the target, then verify.");
  }

  async function onVerify() {
    setDomainMsg(null);
    const res = await fetch("/v1/billing/domain/verify", {
      method: "POST",
      credentials: "include",
    });
    const json = (await res.json().catch(() => null)) as
      | Billing["domain"] & { error?: string }
      | null;
    if (!res.ok) {
      setDomainMsg(json?.error ?? "Could not verify domain.");
      return;
    }
    setState((prev) => (prev && json ? { ...prev, domain: json } : prev));
    setDomainMsg(json?.verified ? "Domain verified." : "Still pending.");
  }

  return (
    <div className="flex flex-col gap-6">
      {state.entitled ? null : (
        <Alert>
          <CircleAlert />
          <AlertTitle>You&apos;re on the free plan</AlertTitle>
          <AlertDescription>
            Pro keeps completed documents a year and adds your name and logo for
            signers.
          </AlertDescription>
        </Alert>
      )}
      <SettingsSection
        title="Plan"
        description="Free is the fax. Pro keeps completed files a year."
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{state.entitled ? "Pro" : "Free"}</CardTitle>
              <Badge variant="outline">{state.entitled ? "$19/mo" : "$0"}</Badge>
            </div>
            <CardDescription>
              {state.entitled
                ? "Keep completed documents a year."
                : "Send, sign, shred after 7 days."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {state.entitled ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm">You&apos;re on Pro.</p>
                {canEdit ? (
                  <form action="/v1/billing/portal" method="POST">
                    <Button type="submit" variant="outline">
                      Manage billing
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : (
              <form action="/upgrade/checkout" method="POST">
                <Button
                  type="submit"
                  className="bg-brand-wax text-primary-foreground hover:bg-brand-wax/90"
                >
                  Upgrade
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </SettingsSection>
      <Separator />
      <SettingsSection
        title="Usage"
        description="What this team has used against the same caps the API enforces."
      >
        <Card>
          <CardContent className="flex flex-col gap-5">
            <Meter label="Documents sent" meter={state.usage.sends} />
            <Meter label="Team seats" meter={state.usage.seats} />
            <Meter label="Templates" meter={state.usage.templates} />
            <Meter label="Named agents" meter={state.usage.agents} />
          </CardContent>
        </Card>
      </SettingsSection>
      <Separator />
      <SettingsSection
        title="Payment method"
        description="Cards live at Stripe. We never collect a card number here."
      >
        <Card>
          <CardContent className="flex flex-col gap-3">
            {state.payment_method ? (
              <p className="text-sm">
                {state.payment_method.brand} ending in {state.payment_method.last4}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {state.entitled
                  ? "No card on file yet. Manage billing to add one."
                  : "Upgrade to add a payment method."}
              </p>
            )}
            {state.entitled && canEdit ? (
              <form action="/v1/billing/portal" method="POST">
                <Button type="submit" variant="outline">
                  Update payment method
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </SettingsSection>
      <Separator />
      <SettingsSection
        title="Custom domain"
        description="Pro signing links can live on your hostname. Mail still comes from us."
      >
        <Card>
          <CardContent className="flex flex-col gap-4">
            {!state.entitled ? (
              <p className="text-sm text-muted-foreground">
                Custom signing domains are on Pro.
              </p>
            ) : (
              <>
                <form onSubmit={onSaveDomain} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="hostname">Hostname</Label>
                    <Input
                      id="hostname"
                      value={hostname}
                      onChange={(e) => setHostname(e.target.value)}
                      placeholder="sign.example.com"
                      disabled={!canEdit}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    CNAME this host to{" "}
                    <span className="font-mono">{state.domain.cname_target}</span>
                    {state.domain.verified ? " · verified" : " · pending"}
                  </p>
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variant="outline">
                        Save domain
                      </Button>
                      <Button type="button" variant="outline" onClick={onVerify}>
                        Verify
                      </Button>
                    </div>
                  ) : null}
                </form>
                {domainMsg ? (
                  <p className="text-sm text-muted-foreground">{domainMsg}</p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </SettingsSection>
    </div>
  );
}
