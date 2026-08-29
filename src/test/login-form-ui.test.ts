// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LoginForm } from "../../app/login/login-form.js";

afterEach(() => cleanup());

describe("login form layout", () => {
  it("puts Google, GitHub, and passkey before the email field", () => {
    const { container } = render(
      createElement(LoginForm, { email: "", next: "/documents" }),
    );
    const html = container.innerHTML;
    expect(html.indexOf("Continue with Google")).toBeGreaterThan(-1);
    expect(html.indexOf("Continue with Google")).toBeLessThan(html.indexOf('id="email"'));
    expect(html.indexOf("Continue with GitHub")).toBeLessThan(html.indexOf('id="email"'));
    expect(html.indexOf("Sign in with passkey")).toBeLessThan(html.indexOf('id="email"'));
  });

  it("shows social methods as icon-only controls with accessible names", () => {
    render(createElement(LoginForm, { email: "", next: "/" }));
    const google = screen.getByRole("link", { name: /continue with google/i });
    const github = screen.getByRole("link", { name: /continue with github/i });
    const passkey = screen.getByRole("button", { name: /sign in with passkey/i });
    expect(google.querySelector("svg")).toBeTruthy();
    expect(github.querySelector("svg")).toBeTruthy();
    expect(passkey.querySelector("svg")).toBeTruthy();
    expect(google.textContent?.replace(/\s+/g, "")).toBe("");
    expect(github.textContent?.replace(/\s+/g, "")).toBe("");
    expect(passkey.textContent?.replace(/\s+/g, "")).toBe("");
  });

  it("carries next through the Google and GitHub links", () => {
    render(createElement(LoginForm, { email: "", next: "/documents" }));
    expect(
      screen.getByRole("link", { name: /continue with google/i }).getAttribute("href"),
    ).toBe("/login/google?next=%2Fdocuments");
    expect(
      screen.getByRole("link", { name: /continue with github/i }).getAttribute("href"),
    ).toBe("/login/github?next=%2Fdocuments");
  });

  it("keeps password login primary with the magic link as fallback", () => {
    render(createElement(LoginForm, { email: "jane@example.com", next: "/" }));
    const login = screen.getByRole("button", { name: /^log in$/i });
    expect(login.getAttribute("value")).toBe("password");
    const magic = screen.getByRole("button", { name: /email me a link/i });
    expect(magic.getAttribute("value")).toBe("magic");
    // Password first, so Enter submits it when a password is typed.
    expect(
      login.compareDocumentPosition(magic) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("offers create account as a text action, not a third stacked button", () => {
    render(createElement(LoginForm, { email: "", next: "/" }));
    const create = screen.getByRole("button", { name: /create an account/i });
    expect(create.getAttribute("value")).toBe("signup");
    expect(create.getAttribute("type")).toBe("submit");
    expect(screen.queryByRole("button", { name: /^create account$/i })).toBeNull();
  });

  it("toggles password visibility", () => {
    render(createElement(LoginForm, { email: "", next: "/" }));
    expect(screen.getByLabelText(/^password$/i).getAttribute("type")).toBe(
      "password",
    );
    fireEvent.click(screen.getByRole("button", { name: /show password/i }));
    expect(screen.getByLabelText(/^password$/i).getAttribute("type")).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: /hide password/i }));
    expect(screen.getByLabelText(/^password$/i).getAttribute("type")).toBe(
      "password",
    );
  });
});
