// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Home from "../../app/page.js";

describe("Home", () => {
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
    const pre = document.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre!.textContent).toMatch(/curl/i);
    expect(pre!.textContent).toContain("/v1/envelopes");
    expect(pre!.textContent).toContain("Repair");
    expect(pre!.textContent).toContain("shop@example.com");
    expect(pre!.textContent).toContain("file=@form.pdf");
    expect(screen.getByRole("link", { name: /log in/i }).getAttribute("href")).toBe(
      "/login",
    );

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

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v1/envelopes");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect(await screen.findByText(/Check your email for a code/i)).toBeTruthy();

    vi.unstubAllGlobals();
  });
});
