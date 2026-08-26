// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SigningCeremony } from "../../app/s/[token]/signing-ceremony.js";

const baseState = {
  title: "Repair authorization",
  signerName: "Jane",
  signerEmail: "jane@example.com",
  sequentialWait: false,
  expiresAt: "2026-09-01T00:00:00.000Z",
};

describe("SigningCeremony fields UI", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("no-fields path still has the canvas and Finish button", () => {
    render(
      createElement(SigningCeremony, {
        token: "tok",
        consentText: "I agree",
        state: baseState,
      }),
    );
    expect(document.querySelector("canvas")).toBeTruthy();
    expect(screen.getByRole("button", { name: /finish/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /decline/i })).toBeTruthy();
  });

  it("with fields, Finish posts values and a sig file after consent", async () => {
    const pngBytes = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation(function (cb: BlobCallback) {
        cb(new Blob([pngBytes], { type: "image/png" }));
      });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/preview")) {
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          headers: { "content-type": "application/pdf" },
        });
      }
      if (url.endsWith("/consent")) return Response.json({ ok: true });
      if (url.endsWith("/sign")) {
        const body = init?.body as FormData;
        expect(body.get("values")).toBeTruthy();
        const sig = body.get("sig:sig");
        expect(sig).toBeTruthy();
        expect(sig instanceof Blob).toBe(true);
        expect((sig as Blob).size).toBeGreaterThan(0);
        expect(body.get("png")).toBeTruthy();
        return Response.json({ status: "completed", shred_at: "2026-09-01" });
      }
      return new Response("no", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(SigningCeremony, {
        token: "tok",
        consentText: "I agree",
        state: {
          ...baseState,
          id: "doc-1",
          fields: [
            {
              name: "sig",
              type: "signature",
              role: "Signer 1",
              required: true,
              readonly: false,
              areas: [{ page: 1, x: 10, y: 80, w: 40, h: 10 }],
            },
          ],
          values: {},
        },
      }),
    );

    const sigBox = await screen.findByRole("button", { name: /^sig$/i });
    fireEvent.click(sigBox);
    const save = await screen.findByRole("button", { name: /save signature/i });
    fireEvent.click(save);
    expect(toBlobSpy).toHaveBeenCalled();

    fireEvent.click(screen.getByText("I agree"));

    const finish = screen.getByRole("button", { name: /finish/i });
    await waitFor(() =>
      expect((finish as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(finish);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/sign"))).toBe(
        true,
      );
    });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/preview"))).toBe(
      true,
    );
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/consent"))).toBe(
      true,
    );
    await screen.findByText(/download this/i);
  });

  it("framed with embed_origin posts completed and redirects", async () => {
    const postMessage = vi.fn();
    const parent = { postMessage };
    const topLocation = { href: "http://sign.test/s/tok" };
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      value: { location: topLocation },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/consent")) return Response.json({ ok: true });
      if (url.endsWith("/sign")) {
        return Response.json({ status: "completed", shred_at: "2026-09-01" });
      }
      return new Response("no", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(SigningCeremony, {
        token: "tok",
        consentText: "I agree",
        state: {
          ...baseState,
          id: "doc-1",
          embed_origin: "https://app.example.com",
          completed_redirect_url: "https://app.example.com/done",
        },
      }),
    );

    fireEvent.click(screen.getByText("I agree"));
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: "agentsign",
          event: "completed",
          id: "doc-1",
          status: "completed",
        },
        "https://app.example.com",
      );
    });
    expect(topLocation.href).toBe("https://app.example.com/done");
  });

  it("framed with embed_origin posts declined", async () => {
    const postMessage = vi.fn();
    const parent = { postMessage };
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/decline")) {
        return Response.json({ status: "declined" });
      }
      return new Response("no", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      createElement(SigningCeremony, {
        token: "tok",
        consentText: "I agree",
        state: {
          ...baseState,
          id: "doc-1",
          embed_origin: "https://app.example.com",
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /decline/i }));

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          source: "agentsign",
          event: "declined",
          id: "doc-1",
          status: "declined",
        },
        "https://app.example.com",
      );
    });
  });
});
