// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SendClient } from "../../app/send/send-client.js";

function whoamiOk() {
  return new Response(JSON.stringify({ email: "shop@example.com" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function submitForm() {
  const form = screen
    .getByRole("button", { name: /^send$/i })
    .closest("form");
  if (!form) throw new Error("send form not found");
  fireEvent.submit(form);
}

async function fillAndSubmit() {
  await screen.findByLabelText(/sender email/i);
  fireEvent.change(screen.getByLabelText(/^title$/i), {
    target: { value: "Repair authorization" },
  });
  fireEvent.change(screen.getByLabelText(/^signer name$/i), {
    target: { value: "Jane" },
  });
  fireEvent.change(screen.getByLabelText(/^signer email$/i), {
    target: { value: "jane@example.com" },
  });
  submitForm();
}

describe("SendClient", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("prefills sender email from whoami and starts with one signer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    const sender = (await screen.findByLabelText(
      /sender email/i,
    )) as HTMLInputElement;
    expect(sender.value).toBe("shop@example.com");
    expect(screen.getByLabelText(/^signer name$/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /add signer/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove signer/i })).toBeNull();
  });

  it("adds and removes signer rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await screen.findByLabelText(/sender email/i);
    fireEvent.click(screen.getByRole("button", { name: /add signer/i }));
    expect(screen.getByLabelText(/signer 2 name/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /remove signer 2/i }));
    expect(screen.queryByLabelText(/signer 2 name/i)).toBeNull();
  });

  it("posts signers as JSON and moves to the confirm step", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url) === "/auth/whoami") return whoamiOk();
        if (String(url) === "/v1/envelopes") {
          return new Response(
            JSON.stringify({ id: "env_1", status: "pending_sender" }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );
    render(createElement(SendClient));
    await fillAndSubmit();
    await screen.findByText(/confirm to send/i);
    const post = calls.find((c) => c.url === "/v1/envelopes");
    expect(post).toBeTruthy();
    const body = post?.init?.body as FormData;
    expect(JSON.parse(String(body.get("signers")))).toEqual([
      { name: "Jane", email: "jane@example.com" },
    ]);
    expect(String(body.get("sender_email"))).toBe("shop@example.com");
    expect(screen.getByText(/shop@example\.com/)).toBeTruthy();
  });

  it("shows the key once and the signer link after the code is confirmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url) === "/auth/whoami") return whoamiOk();
        if (String(url) === "/v1/envelopes") {
          return new Response(JSON.stringify({ id: "env_1" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (String(url) === "/v1/envelopes/env_1/otp") {
          return new Response(
            JSON.stringify({
              key: "sign_live_abc123",
              signers: [
                { email: "jane@example.com", sign_url: "https://s.test/sig" },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );
    render(createElement(SendClient));
    await fillAndSubmit();
    await screen.findByText(/confirm to send/i);
    fireEvent.change(screen.getByLabelText(/verification code/i), {
      target: { value: "123456" },
    });
    const form = screen
      .getByRole("button", { name: /^confirm$/i })
      .closest("form");
    if (!form) throw new Error("confirm form not found");
    fireEvent.submit(form);
    await screen.findByText("sign_live_abc123");
    expect(
      screen.getByRole("link", { name: "https://s.test/sig" }).getAttribute("href"),
    ).toBe("https://s.test/sig");
    expect(
      screen.getByRole("link", { name: /open cabinet/i }).getAttribute("href"),
    ).toBe("/envelopes");
  });
});
