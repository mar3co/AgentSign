// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SecretBlock } from "../../components/secret-block.js";

describe("SecretBlock", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("copies the value and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      createElement(SecretBlock, {
        label: "Document key",
        value: "sign_tmp_abc",
        note: "Save it now.",
      }),
    );
    expect(screen.getByText("sign_tmp_abc")).toBeTruthy();
    expect(screen.getByText("Save it now.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /copy document key/i }));
    expect(writeText).toHaveBeenCalledWith("sign_tmp_abc");
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
  });

  it("explains when the clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
    });
    render(createElement(SecretBlock, { label: "Key", value: "v" }));
    fireEvent.click(screen.getByRole("button", { name: /copy key/i }));
    await waitFor(() =>
      expect(screen.getByText(/select the text/i)).toBeTruthy(),
    );
  });
});
