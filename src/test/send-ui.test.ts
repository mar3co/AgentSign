// @vitest-environment happy-dom
import { createElement, useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../app/send/pdf-preview.js", () => ({
  PdfPreview: ({
    overlay,
    onPagesRendered,
  }: {
    overlay?: (pageIndex: number) => ReactNode;
    onPagesRendered?: (pageCount: number) => void;
  }) => {
    useEffect(() => {
      onPagesRendered?.(1);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return createElement(
      "div",
      { "data-page": 1, style: { position: "relative" } },
      overlay?.(0),
    );
  },
}));

import { SendClient } from "../../app/send/send-client.js";
import { UploadDropzone } from "../../components/upload-dropzone.js";

function whoamiOk() {
  return new Response(JSON.stringify({ email: "shop@example.com" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function pdfFile() {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", {
    type: "application/pdf",
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

async function selectPdf() {
  await screen.findByLabelText(/sender email/i);
  const input = document.querySelector(
    "input[type=file]",
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [pdfFile()] });
  fireEvent.change(input);
  await screen.findByRole("button", { name: "Signature" });
}

async function fillAndSubmitTwoSigners() {
  fireEvent.change(screen.getByLabelText(/^title$/i), {
    target: { value: "Repair authorization" },
  });
  fireEvent.change(screen.getByLabelText(/signer 1 name/i), {
    target: { value: "Jane" },
  });
  fireEvent.change(screen.getByLabelText(/signer 1 email/i), {
    target: { value: "jane@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/signer 2 name/i), {
    target: { value: "Bob" },
  });
  fireEvent.change(screen.getByLabelText(/signer 2 email/i), {
    target: { value: "bob@example.com" },
  });
  submitForm();
}

function stubDocumentsFetch() {
  const bodies: FormData[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("whoami")) return whoamiOk();
      bodies.push(init!.body as FormData);
      return new Response(JSON.stringify({ id: "d1" }), { status: 201 });
    }),
  );
  return bodies;
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
        if (String(url) === "/v1/documents") {
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
    const post = calls.find((c) => c.url === "/v1/documents");
    expect(post).toBeTruthy();
    const body = post?.init?.body as FormData;
    expect(JSON.parse(String(body.get("signers")))).toEqual([
      { name: "Jane", email: "jane@example.com", role: "Signer 1" },
    ]);
    expect(String(body.get("sender_email"))).toBe("shop@example.com");
    expect(screen.getByText(/shop@example\.com/)).toBeTruthy();
  });

  it("shows the key once and the signer link after the code is confirmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url) === "/auth/whoami") return whoamiOk();
        if (String(url) === "/v1/documents") {
          return new Response(JSON.stringify({ id: "env_1" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        if (String(url) === "/v1/documents/env_1/otp") {
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
      screen.getByRole("link", { name: /open documents/i }).getAttribute("href"),
    ).toBe("/documents");
  });

  it("notifies when a file is chosen", async () => {
    const seen: (File | null)[] = [];
    render(
      createElement(UploadDropzone, {
        id: "f",
        name: "f",
        accept: "application/pdf",
        onFileChange: (f: File | null) => seen.push(f),
      }),
    );
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);
    expect(seen).toEqual([file]);
  });

  it("posts order=parallel when All at once is chosen", async () => {
    const bodies = stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    fireEvent.click(screen.getByRole("button", { name: /add signer/i }));
    fireEvent.click(screen.getByRole("radio", { name: /all at once/i }));
    await fillAndSubmitTwoSigners();
    expect(bodies[0]!.get("order")).toBe("parallel");
  });

  it("omits order and fields by default and includes roles on signers", async () => {
    const bodies = stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    fireEvent.click(screen.getByRole("button", { name: /add signer/i }));
    await fillAndSubmitTwoSigners();
    expect(bodies[0]!.get("order")).toBeNull();
    expect(bodies[0]!.get("fields")).toBeNull();
    const signers = JSON.parse(String(bodies[0]!.get("signers")));
    expect(signers[0].role).toBe("Signer 1");
    expect(signers[1].role).toBe("Signer 2");
  });

  it("sends the message field when filled", async () => {
    const bodies = stubDocumentsFetch();
    render(createElement(SendClient));
    await screen.findByLabelText(/sender email/i);
    fireEvent.change(
      screen.getByLabelText(/message to signers/i),
      { target: { value: "Please sign." } },
    );
    await fillAndSubmit();
    expect(bodies[0]!.get("message")).toBe("Please sign.");
  });

  it("serializes placed fields into the fields param", async () => {
    const bodies = stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    fireEvent.click(screen.getByRole("button", { name: "Signature" }));
    fireEvent.click(screen.getByTestId("field-layer"), {
      clientX: 100,
      clientY: 100,
    });
    await fillAndSubmit();
    const fields = JSON.parse(String(bodies[0]!.get("fields")));
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe("signature");
    expect(fields[0].role).toBe("Signer 1");
  });

  it("shows a summary line on the confirm step", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await fillAndSubmit();
    expect(await screen.findByText(/1 signer/i)).toBeTruthy();
  });
});
