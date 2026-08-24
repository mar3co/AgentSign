"use client";

import { useState, type FormEvent } from "react";
import {
  createPasskey,
  getPasskey,
  isWebAuthnCancel,
  supportsWebAuthn,
} from "@/src/lib/auth/webauthn";
import { LinkButton } from "@/components/link-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export function LoginForm({ email, next }: { email: string; next: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passkeyOffer, setPasskeyOffer] = useState<string | null>(null);

  const oauthNext = next ? `?next=${encodeURIComponent(next)}` : "";

  async function post(path: string, body: unknown, after: "magic" | "signup" | "session") {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        next?: string;
      } | null;
      if (!res.ok) {
        setError(json?.error ?? "Could not continue.");
        return;
      }
      if (after === "magic") setMessage("Check your email for a link.");
      else if (after === "signup") setMessage("Confirm your email, then log in.");
      else if (supportsWebAuthn()) {
        setPasskeyOffer(json?.next || "/");
      } else {
        window.location.href = json?.next || "/";
      }
    } catch {
      setError("Could not continue.");
    } finally {
      setBusy(false);
    }
  }

  function values(form: HTMLFormElement) {
    const data = new FormData(form);
    return {
      email: String(data.get("email") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    };
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as
      | HTMLButtonElement
      | null;
    const action = submitter?.value ?? "magic";
    const { email: value, password } = values(e.currentTarget);
    if (action === "password") {
      void post("/login/session", { email: value, password, next }, "session");
    } else if (action === "signup") {
      void post("/signup", { email: value, password }, "signup");
    } else {
      void post("/login/session", { email: value, next }, "magic");
    }
  }

  async function signInPasskey() {
    if (!supportsWebAuthn()) {
      setError("This browser does not support passkeys.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const start = await fetch("/login/passkey/options", { method: "POST" });
      const startJson = (await start.json().catch(() => null)) as {
        error?: string;
        challenge_id?: string;
        options?: Record<string, unknown>;
      } | null;
      if (!start.ok || !startJson?.challenge_id || !startJson.options) {
        setError(startJson?.error ?? "Could not continue.");
        return;
      }
      const credential = await getPasskey(startJson.options);
      const res = await fetch("/login/passkey/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challenge_id: startJson.challenge_id,
          credential,
          next,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        next?: string;
      } | null;
      if (!res.ok) {
        setError(json?.error ?? "Could not continue.");
        return;
      }
      window.location.href = json?.next || "/";
    } catch (e) {
      if (!isWebAuthnCancel(e)) setError("Could not continue.");
    } finally {
      setBusy(false);
    }
  }

  async function enrollThenGo(nextUrl: string) {
    setBusy(true);
    setError(null);
    try {
      const start = await fetch("/auth/passkeys/options", { method: "POST" });
      if (start.ok) {
        const startJson = (await start.json()) as {
          challenge_id: string;
          options: Record<string, unknown>;
        };
        const credential = await createPasskey(startJson.options);
        await fetch("/auth/passkeys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            challenge_id: startJson.challenge_id,
            credential,
          }),
        });
      }
    } catch {
      // Cancel or failure should not block getting into the app.
    } finally {
      window.location.href = nextUrl;
    }
  }

  if (passkeyOffer) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertDescription>
                Save a passkey so the next sign-in can use Face ID, Touch ID, or a
                security key.
              </AlertDescription>
            </Alert>
          )}
          <Button
            className="h-11 w-full text-base"
            type="button"
            disabled={busy}
            onClick={() => void enrollThenGo(passkeyOffer)}
          >
            Save a passkey
          </Button>
          <Button
            className="h-11 w-full text-base"
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              window.location.href = passkeyOffer;
            }}
          >
            Not now
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              defaultValue={email}
              className="h-11 text-base md:text-base"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              className="h-11 text-base md:text-base"
            />
          </div>
          {message ? (
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            className="h-11 w-full text-base"
            type="submit"
            name="intent"
            value="magic"
            disabled={busy}
          >
            Email me a link
          </Button>
          <Button
            className="h-11 w-full text-base"
            type="submit"
            name="intent"
            value="password"
            disabled={busy}
            variant="secondary"
          >
            Log in with password
          </Button>
          <Button
            className="h-11 w-full text-base"
            type="submit"
            name="intent"
            value="signup"
            disabled={busy}
            variant="outline"
          >
            Create account
          </Button>
          <Separator />
          <p className="text-center font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
            or
          </p>
          <Button
            className="h-11 w-full text-base"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void signInPasskey()}
          >
            Sign in with passkey
          </Button>
          <LinkButton
            href={`/login/google${oauthNext}`}
            variant="outline"
            className="h-11 w-full text-base"
          >
            Continue with Google
          </LinkButton>
          <LinkButton
            href={`/login/github${oauthNext}`}
            variant="outline"
            className="h-11 w-full text-base"
          >
            Continue with GitHub
          </LinkButton>
        </form>
      </CardContent>
    </Card>
  );
}
