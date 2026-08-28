import { afterEach, describe, expect, it, vi } from "vitest";
import { docxToPdf, DocxConvertError, DocxUnavailableError } from "../lib/docx.js";
import { normalizeUploadToPdf } from "../routes/documents.js";
import { minimalPdf } from "./pdf.js";

vi.mock("../lib/docx.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/docx.js")>();
  return { ...mod, docxToPdf: vi.fn(mod.docxToPdf) };
});

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function docxFile(): File {
  const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  return new File([zipMagic as BlobPart], "letter.docx", { type: DOCX_MIME });
}

afterEach(() => {
  vi.mocked(docxToPdf).mockReset();
});

describe("normalizeUploadToPdf", () => {
  it("passes PDF bytes through untouched", async () => {
    const pdf = await minimalPdf();
    const result = await normalizeUploadToPdf(
      new File([pdf as BlobPart], "doc.pdf", { type: "application/pdf" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes).toEqual(new Uint8Array(pdf));
  });

  it("rejects oversized uploads", async () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    const result = await normalizeUploadToPdf(
      new File([big as BlobPart], "big.pdf", { type: "application/pdf" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it("rejects legacy .doc with a save-as message", async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    const result = await normalizeUploadToPdf(
      new File([ole as BlobPart], "old.doc", { type: "application/msword" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const json = (await result.response.json()) as { error: string };
      expect(json.error).toContain("Save the file as .docx or PDF");
    }
  });

  it("rejects files that are neither PDF nor DOCX", async () => {
    const result = await normalizeUploadToPdf(
      new File(["hello" as BlobPart], "notes.txt", { type: "text/plain" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it("converts a DOCX and returns the PDF bytes", async () => {
    const pdf = new Uint8Array(await minimalPdf());
    vi.mocked(docxToPdf).mockResolvedValueOnce(pdf);
    const result = await normalizeUploadToPdf(docxFile());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes).toBe(pdf);
  });

  it("maps an unreadable DOCX to 400 invalid_docx", async () => {
    vi.mocked(docxToPdf).mockRejectedValueOnce(new DocxConvertError("bad zip"));
    const result = await normalizeUploadToPdf(docxFile());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const json = (await result.response.json()) as { code: string };
      expect(json.code).toBe("invalid_docx");
    }
  });

  it("maps missing conversion infrastructure to 503", async () => {
    vi.mocked(docxToPdf).mockRejectedValueOnce(
      new DocxUnavailableError("no chromium"),
    );
    const result = await normalizeUploadToPdf(docxFile());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      const json = (await result.response.json()) as { code: string };
      expect(json.code).toBe("docx_unavailable");
    }
  });

  it("maps unexpected conversion failures to 500, not a file error", async () => {
    vi.mocked(docxToPdf).mockRejectedValueOnce(new Error("tmp full"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await normalizeUploadToPdf(docxFile());
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(500);
      const json = (await result.response.json()) as { code: string };
      expect(json.code).toBe("docx_error");
    }
  });

  it("rejects a converted PDF that exceeds the size limit", async () => {
    vi.mocked(docxToPdf).mockResolvedValueOnce(
      new Uint8Array(20 * 1024 * 1024 + 1),
    );
    const result = await normalizeUploadToPdf(docxFile());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const json = (await result.response.json()) as { code: string };
      expect(json.code).toBe("file_too_large");
    }
  });
});
