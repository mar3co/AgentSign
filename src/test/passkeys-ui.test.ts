// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PasskeysClient } from "../../app/settings/passkeys/passkeys-client.js";
import { LoginForm } from "../../app/login/login-form.js";
import { supportsWebAuthn } from "@/src/lib/auth/webauthn";

vi.mock("@/src/lib/auth/webauthn", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/auth/webauthn")>();
  return {
    ...actual,
    supportsWebAuthn: vi.fn(() => false),
  };
});

describe("PasskeysClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists passkeys and offers add", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            passkeys: [
              {
                id: "pk_1",
                friendly_name: "iCloud Keychain",
                created_at: "2026-08-01T00:00:00.000Z",
                last_used_at: null,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    render(createElement(PasskeysClient));
    expect(await screen.findByText("iCloud Keychain")).toBeTruthy();
    expect(screen.getByRole("button", { name: /add a passkey/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove/i })).toBeTruthy();
  });

  it("shows an empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ passkeys: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(createElement(PasskeysClient));
    expect(await screen.findByText(/no passkeys yet/i)).toBeTruthy();
  });
});

describe("LoginForm passkey", () => {
  beforeEach(() => {
    vi.mocked(supportsWebAuthn).mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders sign in with passkey without requiring email", () => {
    render(createElement(LoginForm, { email: "", next: "/" }));
    const btn = screen.getByRole("button", { name: /sign in with passkey/i });
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("offers to save a passkey after password login", async () => {
    vi.mocked(supportsWebAuthn).mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, next: "/documents" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(createElement(LoginForm, { email: "shop@example.com", next: "/documents" }));
    const email = screen.getByLabelText(/^email$/i) as HTMLInputElement;
    const password = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    email.value = "shop@example.com";
    password.value = "correct-horse";
    screen.getByRole("button", { name: /^log in$/i }).click();
    expect(await screen.findByRole("button", { name: /save a passkey/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /not now/i })).toBeTruthy();
  });
});
