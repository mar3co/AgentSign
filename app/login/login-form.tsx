"use client";

import { useState, type FormEvent, type SVGProps } from "react";
import { CircleAlert, Eye, EyeOff, FingerprintPattern } from "lucide-react";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const socialClass = "h-11 grow";

export function LoginForm({ email, next }: { email: string; next: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passkeyOffer, setPasskeyOffer] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

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
              <CircleAlert />
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
      <CardContent className="flex flex-col gap-6">
        <div
          role="group"
          aria-label="Sign in with"
          className="flex items-center gap-2.5"
        >
          <LinkButton
            href={`/login/google${oauthNext}`}
            variant="outline"
            className={socialClass}
            aria-label="Continue with Google"
            title="Continue with Google"
          >
            <GoogleMark className="size-5" />
          </LinkButton>
          <LinkButton
            href={`/login/github${oauthNext}`}
            variant="outline"
            className={socialClass}
            aria-label="Continue with GitHub"
            title="Continue with GitHub"
          >
            <GitHubMark className="size-5" />
          </LinkButton>
          <Button
            type="button"
            variant="outline"
            className={socialClass}
            aria-label="Sign in with passkey"
            title="Sign in with passkey"
            disabled={busy}
            onClick={() => void signInPasskey()}
          >
            <FingerprintPattern className="size-5" />
          </Button>
        </div>
        <div className="flex items-center gap-4">
          <Separator className="flex-1" />
          <p className="text-sm text-muted-foreground">or</p>
          <Separator className="flex-1" />
        </div>
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
            <InputGroup className="h-11">
              <InputGroupInput
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="h-11 text-base md:text-base"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-sm"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((open) => !open)}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
          {message ? (
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
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
          <p className="text-center text-sm text-muted-foreground">
            New here?{" "}
            <Button
              type="submit"
              name="intent"
              value="signup"
              disabled={busy}
              variant="link"
              className="h-auto px-0 text-base text-foreground"
            >
              Create an account
            </Button>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function GoogleMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}
