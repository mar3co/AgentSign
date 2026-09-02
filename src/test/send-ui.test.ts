// @vitest-environment happy-dom
import { createElement, useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

const { applyPatchesMock, previewControls } = vi.hoisted(() => ({
  applyPatchesMock: vi.fn(async () => new Uint8Array([9, 9, 9])),
  previewControls: {
    auto: true,
    onPagesRendered: undefined as ((n: number) => void) | undefined,
    onRenderFailed: undefined as (() => void) | undefined,
  },
}));

vi.mock("../../app/send/patch-model.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../app/send/patch-model.js")>();
  return { ...actual, applyPatches: applyPatchesMock };
});

vi.mock("../../app/send/pdf-preview.js", () => ({
  PdfPreview: ({
    overlay,
    onPagesRendered,
    onRenderFailed,
  }: {
    overlay?: (pageIndex: number) => ReactNode;
    onPagesRendered?: (pageCount: number) => void;
    onRenderFailed?: () => void;
  }) => {
    useEffect(() => {
      previewControls.onPagesRendered = onPagesRendered;
      previewControls.onRenderFailed = onRenderFailed;
      if (previewControls.auto) onPagesRendered?.(1);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return createElement(
      "div",
      { "data-page": 1, style: { position: "relative" } },
      overlay?.(0),
    );
  },
}));

// The real AppShell brings nav, search, and notification chrome that would
// bloat these tests; render just the canvas (children) and the step rail.
// The mobile bar is omitted so there is exactly one Send button.
vi.mock("../../components/app-shell.js", () => ({
  AppShell: ({ children, rail }: { children?: ReactNode; rail?: ReactNode }) =>
    createElement("div", null, children, rail ?? null),
}));

vi.mock("../../src/lib/pdf/tags.js", () => ({
  parsePdfTags: async () => ({
    fields: [
      {
        name: "sig",
        type: "signature",
        role: "Signer 1",
        required: true,
        readonly: false,
        areas: [{ page: 1, x: 10, y: 80, w: 20, h: 5 }],
      },
    ],
    pdf: new Uint8Array(),
  }),
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

// The form element wraps the canvas; the rail's inputs and the Send button
// associate with it through the form attribute, so submit it by id.
function submitForm() {
  const form = document.getElementById("send-form");
  if (!form) throw new Error("send form not found");
  fireEvent.submit(form);
}

/** Expand a rail step (headers toggle, so only click when collapsed). */
function ensureStep(name: RegExp) {
  const btn = screen.getByRole("button", { name });
  if (btn.getAttribute("aria-expanded") !== "true") fireEvent.click(btn);
}

async function railReady() {
  await screen.findByRole("button", { name: /^document$/i });
}

// The same message is shown both next to Send and as an inline hint under
// the offending field, so scope the query to the alert to get one match.
async function findAlertText(re: RegExp) {
  const alert = await screen.findByRole("alert");
  return within(alert).getByText(re);
}

async function fillAndSubmit() {
  await railReady();
  ensureStep(/^document$/i);
  fireEvent.change(screen.getByLabelText(/^title$/i), {
    target: { value: "Repair authorization" },
  });
  ensureStep(/^signers$/i);
  fireEvent.change(screen.getByLabelText(/^signer name$/i), {
    target: { value: "Jane" },
  });
  fireEvent.change(screen.getByLabelText(/^signer email$/i), {
    target: { value: "jane@example.com" },
  });
  submitForm();
}

async function selectPdf() {
  await railReady();
  const input = document.querySelector(
    "input[type=file]",
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: [pdfFile()],
    configurable: true,
  });
  fireEvent.change(input);
  await screen.findByText("a.pdf");
}

async function fillAndSubmitTwoSigners() {
  ensureStep(/^document$/i);
  fireEvent.change(screen.getByLabelText(/^title$/i), {
    target: { value: "Repair authorization" },
  });
  ensureStep(/^signers$/i);
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
    previewControls.auto = true;
  });

  it("prefills sender email from whoami and starts with one signer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    const sender = (await screen.findByLabelText(
      /sender email/i,
    )) as HTMLInputElement;
    expect(sender.value).toBe("shop@example.com");
    ensureStep(/^signers$/i);
    expect(screen.getByLabelText(/^signer name$/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /add signer/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove signer/i })).toBeNull();
  });

  it("adds and removes signer rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    ensureStep(/^signers$/i);
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
    await selectPdf();
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
    await selectPdf();
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
    ensureStep(/^signers$/i);
    fireEvent.click(screen.getByRole("button", { name: /add signer/i }));
    fireEvent.click(screen.getByRole("radio", { name: /all at once/i }));
    await fillAndSubmitTwoSigners();
    expect(bodies[0]!.get("order")).toBe("parallel");
  });

  it("omits order and fields by default and includes roles on signers", async () => {
    const bodies = stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^signers$/i);
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
    await selectPdf();
    ensureStep(/^review & send$/i);
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
    ensureStep(/^fields$/i);
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
    await selectPdf();
    await fillAndSubmit();
    expect(await screen.findByText(/1 signer/i)).toBeTruthy();
  });

  it("overlays tag-detected fields read-only after choosing a file", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    expect(await screen.findByText(/from tags/i)).toBeTruthy();
    // read-only: no delete button on tag boxes
    expect(screen.queryByRole("button", { name: /delete field/i })).toBeNull();
  });

  it("keeps signers and placed fields when the file is replaced", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^signers$/i);
    fireEvent.change(screen.getByLabelText(/^signer name$/i), {
      target: { value: "Jane" },
    });
    ensureStep(/^fields$/i);
    fireEvent.click(screen.getByRole("button", { name: "Signature" }));
    fireEvent.click(screen.getByTestId("field-layer"), {
      clientX: 100,
      clientY: 100,
    });
    expect(screen.getByRole("button", { name: /delete field/i })).toBeTruthy();

    const input = document.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pdfFile()] });
    fireEvent.change(input);

    ensureStep(/^signers$/i);
    expect(
      (screen.getByLabelText(/^signer name$/i) as HTMLInputElement).value,
    ).toBe("Jane");
    expect(screen.getByRole("button", { name: /delete field/i })).toBeTruthy();
  });

  it("burns patches into the uploaded file on submit", async () => {
    applyPatchesMock.mockClear();
    const bodies = stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^fields$/i);
    fireEvent.click(screen.getByRole("button", { name: /whiteout/i }));
    const layer = screen.getByTestId("field-layer");
    fireEvent.pointerDown(layer, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer, { clientX: 250, clientY: 150 });
    fireEvent.pointerUp(layer, { clientX: 250, clientY: 150 });
    expect(screen.getByRole("button", { name: /delete patch/i })).toBeTruthy();

    await fillAndSubmit();
    await screen.findByText(/confirm to send/i);
    expect(applyPatchesMock).toHaveBeenCalledTimes(1);
    const blob = bodies[0]!.get("file") as Blob;
    expect(blob.size).toBe(3);
  });

  it("does not touch the file when there are no patches", async () => {
    applyPatchesMock.mockClear();
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    await fillAndSubmit();
    await screen.findByText(/confirm to send/i);
    expect(applyPatchesMock).not.toHaveBeenCalled();
  });

  it("disables Send until the preview settles", async () => {
    previewControls.auto = false;
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    const send = screen.getByRole("button", {
      name: /^send$/i,
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    act(() => previewControls.onPagesRendered?.(1));
    expect(send.disabled).toBe(false);
  });

  it("clears corrections with a notice when the preview fails", async () => {
    previewControls.auto = false;
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^fields$/i);
    fireEvent.click(screen.getByRole("button", { name: /whiteout/i }));
    const layer = screen.getByTestId("field-layer");
    fireEvent.pointerDown(layer, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(layer, { clientX: 250, clientY: 150 });
    fireEvent.pointerUp(layer, { clientX: 250, clientY: 150 });
    expect(screen.getByRole("button", { name: /delete patch/i })).toBeTruthy();
    act(() => previewControls.onRenderFailed?.());
    expect(screen.queryByRole("button", { name: /delete patch/i })).toBeNull();
    expect(screen.getByText(/preview could not be rendered/i)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /^send$/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("keeps the same file input mounted across the switch into the preview layout", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await railReady();
    const inputBefore = document.querySelector("input[type=file]");
    Object.defineProperty(inputBefore as HTMLInputElement, "files", {
      value: [pdfFile()],
    });
    fireEvent.change(inputBefore as HTMLInputElement);
    await screen.findByText("a.pdf");
    expect(document.querySelector("input[type=file]")).toBe(inputBefore);
  });

  it("skips the confirm screen when the send goes out directly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("whoami")) return whoamiOk();
        return new Response(
          JSON.stringify({
            id: "d1",
            status: "pending",
            key: "sign_tmp_abc",
            signers: [{ email: "jane@example.com", sign_url: "/s/tok" }],
          }),
          { status: 201 },
        );
      }),
    );
    render(createElement(SendClient));
    await selectPdf();
    await fillAndSubmit();
    await screen.findByText("sign_tmp_abc");
    expect(screen.queryByText(/confirm to send/i)).toBeNull();
    expect(screen.getByRole("link", { name: "/s/tok" })).toBeTruthy();
  });

  it("reopens the document step with an error when sending without a PDF", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await railReady();
    ensureStep(/^fields$/i); // move away from the document step
    submitForm();
    expect(await findAlertText(/add a document/i)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /^document$/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("reopens the signers step when a signer is incomplete", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^document$/i);
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Repair authorization" },
    });
    submitForm();
    expect(await findAlertText(/signer 1 needs a name/i)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /^signers$/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("names the missing sender email", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^document$/i);
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Repair authorization" },
    });
    fireEvent.change(screen.getByLabelText(/sender email/i), {
      target: { value: "" },
    });
    submitForm();
    expect(await findAlertText(/enter your sender email/i)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /^document$/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("names the missing title", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^document$/i);
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "" },
    });
    submitForm();
    expect(
      await findAlertText(/give the document a title/i),
    ).toBeTruthy();
    const title = screen.getByLabelText(/^title$/i);
    expect(title.getAttribute("aria-invalid")).toBe("true");
  });

  it("names the specific signer missing an email", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^document$/i);
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Repair authorization" },
    });
    ensureStep(/^signers$/i);
    fireEvent.click(screen.getByRole("button", { name: /add signer/i }));
    fireEvent.change(screen.getByLabelText(/signer 1 name/i), {
      target: { value: "Jane" },
    });
    fireEvent.change(screen.getByLabelText(/signer 1 email/i), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/signer 2 name/i), {
      target: { value: "Bob" },
    });
    submitForm();
    expect(
      await findAlertText(/signer 2 needs an email/i),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /^signers$/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("flags an invalid signer email and clears it once fixed", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^document$/i);
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Repair authorization" },
    });
    ensureStep(/^signers$/i);
    fireEvent.change(screen.getByLabelText(/^signer name$/i), {
      target: { value: "Jane" },
    });
    fireEvent.change(screen.getByLabelText(/^signer email$/i), {
      target: { value: "not-an-email" },
    });
    submitForm();
    expect(
      await findAlertText(/signer 1's email is not valid/i),
    ).toBeTruthy();
    const emailInput = screen.getByLabelText(/^signer email$/i);
    expect(emailInput.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(emailInput, { target: { value: "jane@example.com" } });
    expect(
      screen.queryByText(/signer 1's email is not valid/i),
    ).toBeNull();
    expect(emailInput.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("updates the signer email message when cleared to empty after being invalid", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^document$/i);
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Repair authorization" },
    });
    ensureStep(/^signers$/i);
    fireEvent.change(screen.getByLabelText(/^signer name$/i), {
      target: { value: "Jane" },
    });
    fireEvent.change(screen.getByLabelText(/^signer email$/i), {
      target: { value: "not-an-email" },
    });
    submitForm();
    expect(
      await findAlertText(/signer 1's email is not valid/i),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^signer email$/i), {
      target: { value: "" },
    });
    expect(await findAlertText(/signer 1 needs an email/i)).toBeTruthy();
  });

  it("clears a signer error when that signer is removed", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^document$/i);
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Repair authorization" },
    });
    ensureStep(/^signers$/i);
    fireEvent.click(screen.getByRole("button", { name: /add signer/i }));
    fireEvent.change(screen.getByLabelText(/signer 1 name/i), {
      target: { value: "Jane" },
    });
    fireEvent.change(screen.getByLabelText(/signer 1 email/i), {
      target: { value: "jane@example.com" },
    });
    submitForm();
    expect(await findAlertText(/signer 2 needs a name/i)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /remove signer/i })[1]!);
    expect(screen.queryByText(/signer 2 needs a name/i)).toBeNull();
  });

  it("tells a malformed sender email apart from a missing one", async () => {
    stubDocumentsFetch();
    render(createElement(SendClient));
    await selectPdf();
    ensureStep(/^document$/i);
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Repair authorization" },
    });
    fireEvent.change(screen.getByLabelText(/sender email/i), {
      target: { value: "shop" },
    });
    submitForm();
    expect(await findAlertText(/sender email is not valid/i)).toBeTruthy();
  });

  it("auto-fills the title from the chosen filename", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    const input = document.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    const file = new File(
      [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
      "repair_authorization-v2.pdf",
      { type: "application/pdf" },
    );
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
    await screen.findByText("repair_authorization-v2.pdf");
    ensureStep(/^document$/i);
    expect(
      (screen.getByLabelText(/^title$/i) as HTMLInputElement).value,
    ).toBe("Repair authorization v2");
  });

  it("does not overwrite a title the user already typed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    ensureStep(/^document$/i);
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "My custom title" },
    });
    const input = document.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [pdfFile()], configurable: true });
    fireEvent.change(input);
    await screen.findByText("a.pdf");
    expect(
      (screen.getByLabelText(/^title$/i) as HTMLInputElement).value,
    ).toBe("My custom title");
  });

  it("auto-fills the title from a markdown heading in write mode", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    fireEvent.click(
      screen.getByRole("button", { name: /write the document instead/i }),
    );
    fireEvent.change(screen.getByLabelText(/document text/i), {
      target: { value: "# Service Agreement\n\nSign here." },
    });
    ensureStep(/^document$/i);
    expect(
      (screen.getByLabelText(/^title$/i) as HTMLInputElement).value,
    ).toBe("Service Agreement");
  });

  it("leaves the title empty when written text has no heading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    fireEvent.click(
      screen.getByRole("button", { name: /write the document instead/i }),
    );
    fireEvent.change(screen.getByLabelText(/document text/i), {
      target: { value: "Just plain text, no heading." },
    });
    ensureStep(/^document$/i);
    expect(
      (screen.getByLabelText(/^title$/i) as HTMLInputElement).value,
    ).toBe("");
  });

  it("keeps a title auto-filled from a heading after the heading is edited away", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    fireEvent.click(
      screen.getByRole("button", { name: /write the document instead/i }),
    );
    fireEvent.change(screen.getByLabelText(/document text/i), {
      target: { value: "# Service Agreement\n\nSign here." },
    });
    ensureStep(/^document$/i);
    expect(
      (screen.getByLabelText(/^title$/i) as HTMLInputElement).value,
    ).toBe("Service Agreement");
    // Delete the leading "# " -- no line matches the heading pattern anymore,
    // but the title the heading filled in should stick around.
    fireEvent.change(screen.getByLabelText(/document text/i), {
      target: { value: "Service Agreement\n\nSign here." },
    });
    expect(
      (screen.getByLabelText(/^title$/i) as HTMLInputElement).value,
    ).toBe("Service Agreement");
  });

  it("toggles between the dropzone and the write view", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    fireEvent.click(
      screen.getByRole("button", { name: /write the document instead/i }),
    );
    expect(screen.getByLabelText(/document text/i)).toBeTruthy();
    expect(document.querySelector("input[type=file]")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /upload a file instead/i }),
    );
    expect(document.querySelector("input[type=file]")).toBeTruthy();
  });

  it("posts written text as the markdown field, without a file", async () => {
    const bodies = stubDocumentsFetch();
    render(createElement(SendClient));
    await railReady();
    fireEvent.click(
      screen.getByRole("button", { name: /write the document instead/i }),
    );
    fireEvent.change(screen.getByLabelText(/document text/i), {
      target: { value: "# Deal\n\n{{sig}}" },
    });
    await fillAndSubmit();
    await screen.findByText(/confirm to send/i);
    const body = bodies[0]!;
    expect(String(body.get("markdown"))).toBe("# Deal\n\n{{sig}}");
    expect(body.get("file")).toBeNull();
  });

  it("loads a chosen .md file into the write view", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    const input = document.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    const md = new File(["# NDA\n\n{{sig}}"], "nda.md", {
      type: "text/markdown",
    });
    Object.defineProperty(input, "files", { value: [md], configurable: true });
    fireEvent.change(input);
    const textarea = (await screen.findByLabelText(
      /document text/i,
    )) as HTMLTextAreaElement;
    expect(textarea.value).toBe("# NDA\n\n{{sig}}");
  });

  it("keeps a chosen .docx as the file; the server converts it on send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    const input = document.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    const docx = new File([new Uint8Array([0x50, 0x4b])], "deal.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    Object.defineProperty(input, "files", { value: [docx], configurable: true });
    fireEvent.change(input);
    await screen.findByText("deal.docx");
    // Not routed into the write view, and not rejected.
    expect(screen.queryByLabelText(/document text/i)).toBeNull();
    expect(screen.queryByText(/isn't a supported file/i)).toBeNull();
  });

  it("rejects an unsupported file with a clear notice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    const input = document.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    const xlsx = new File([new Uint8Array([1])], "sheet.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    Object.defineProperty(input, "files", { value: [xlsx], configurable: true });
    fireEvent.change(input);
    expect(await screen.findByText(/isn't a supported file/i)).toBeTruthy();
    // The bogus file was cleared, not kept as the selection.
    expect(screen.queryByText("sheet.xlsx")).toBeNull();
  });

  it("lights up the drop target while a file drags anywhere over the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    const enter = new Event("dragenter", { bubbles: true });
    Object.assign(enter, { dataTransfer: { types: ["Files"] } });
    fireEvent(window, enter);
    expect(screen.getByText(/drop your file here/i)).toBeTruthy();
    const leave = new Event("dragleave", { bubbles: true });
    fireEvent(window, leave);
    expect(screen.queryByText(/drop your file here/i)).toBeNull();
  });

  it("accepts a file dropped anywhere on the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => whoamiOk()));
    render(createElement(SendClient));
    await railReady();
    const drop = new Event("drop", { bubbles: true });
    Object.assign(drop, {
      dataTransfer: { types: ["Files"], files: [pdfFile()] },
    });
    fireEvent(window, drop);
    await screen.findByText("a.pdf");
  });
});
