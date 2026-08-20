"use client";

import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

export function LoginForm({ email, next }: { email: string; next: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      } | null;
      if (!res.ok) {
        setError(json?.error ?? "Could not continue.");
        return;
      }
      if (after === "magic") setMessage("Check your email for a link.");
      else if (after === "signup") setMessage("Confirm your email, then log in.");
      else window.location.href = next || "/";
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
      void post("/login", { email: value, password, next }, "session");
    } else if (action === "signup") {
      void post("/signup", { email: value, password }, "signup");
    } else {
      void post("/login", { email: value, next }, "magic");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log in</CardTitle>
        <CardDescription>
          Magic link, password, or Google / GitHub. Same account.
        </CardDescription>
      </CardHeader>
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
          <a className="text-base underline" href={`/login/google${oauthNext}`}>
            Continue with Google
          </a>
          <a className="text-base underline" href={`/login/github${oauthNext}`}>
            Continue with GitHub
          </a>
        </form>
      </CardContent>
    </Card>
  );
}
