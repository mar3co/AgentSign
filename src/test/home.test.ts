// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import Home from "../../app/page.js";

async function fillSendForm() {
  // The hero starts compact; the send fields appear once a PDF is being chosen.
  fireEvent.click(screen.getByText("Choose a PDF"));
  fireEvent.change(screen.getByLabelText(/title/i), {
    target: { value: "Repair authorization" },
  });
  fireEvent.change(screen.getByLabelText(/sender email/i), {
    target: { value: "shop@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/signer name/i), {
    target: { value: "Jane" },
  });
  fireEvent.change(screen.getByLabelText(/signer email/i), {
    target: { value: "jane@example.com" },
  });
  const file = new File(["%PDF-1.4"], "form.pdf", { type: "application/pdf" });
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.submit(screen.getByRole("button", { name: /send/i }).closest("form")!);
}

describe("Home", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows PDF drop, curl example, and posts to /v1/envelopes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "env_1", status: "pending_sender" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(createElement(Home));

    expect(document.querySelector('input[type="file"]')).toBeTruthy();
    expect(screen.getByText("Drop a PDF to send it")).toBeTruthy();
    const pre = document.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toMatch(/curl/i);
    expect(pre!.textContent).toContain("/v1/envelopes");
    expect(pre!.textContent).toContain("Repair");
    expect(pre!.textContent).toContain("you@example.com");
    expect(pre!.textContent).toContain("file=@form.pdf");
    expect(screen.getByRole("link", { name: /log in/i }).getAttribute("href")).toBe(
      "/login",
    );
    expect(
      screen.getByRole("heading", {
        name: /easy signing for everything, by people and their ai agents/i,
      }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/20 envelopes/i);
    expect(document.body.textContent).not.toMatch(/AI signing/i);
    expect(screen.getByRole("img", { name: /byterange/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /privacy/i }).getAttribute("href")).toBe(
      "/privacy",
    );

    await fillSendForm();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v1/envelopes");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect(await screen.findByText(/Check your email for a code/i)).toBeTruthy();
  });

  it("keeps envelope id, verifies OTP without login, and shows tmp key plus signer URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "env_1", status: "pending_sender" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "env_1",
            status: "pending",
            key: "sign_tmp_abc",
            signers: [{ email: "jane@example.com", sign_url: "/s/tok_1" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(createElement(Home));
    await fillSendForm();
    expect(await screen.findByText(/Check your email for a code/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /log in/i })).toBeNull();

    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /verify/i }).closest("form")!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const [otpUrl, otpInit] = fetchMock.mock.calls[1]!;
    expect(otpUrl).toBe("/v1/envelopes/env_1/otp");
    expect(otpInit?.method).toBe("POST");
    expect(otpInit?.headers).toMatchObject({
      "content-type": "application/json",
    });
    expect(JSON.parse(String(otpInit?.body))).toEqual({ code: "123456" });

    expect(await screen.findByText("sign_tmp_abc")).toBeTruthy();
    const signer = screen.getByRole("link", { name: "/s/tok_1" });
    expect(signer.getAttribute("href")).toBe("/s/tok_1");
    expect(screen.getByRole("link", { name: /log in/i }).getAttribute("href")).toBe(
      "/login",
    );
  });
});
