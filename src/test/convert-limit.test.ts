import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docxToPdf } from "../lib/docx.js";
import { POST as postDocument } from "../../app/v1/documents/route.js";
import type { AuthAdapter } from "../lib/auth/supabase.js";
import { resetDeps, setDeps } from "../lib/deps.js";
import { createFsStore } from "../lib/storage.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

vi.mock("../lib/docx.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../lib/docx.js")>();
  return { ...mod, docxToPdf: vi.fn(mod.docxToPdf) };
});

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function docxRequest(headers: Record<string, string>): Request {
  const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  const body = new FormData();
  body.set("title", "Letter");
  body.set("sender_email", "shop@example.com");
  body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
  body.set("file", new File([zipMagic as BlobPart], "letter.docx", { type: DOCX_MIME }));
  return new Request("http://sign.test/v1/documents", { method: "POST", headers, body });
}

async function bootAnonDeps() {
  // No cookie resolves to a user, so conversion keys fall back to client IP.
  const adapter: AuthAdapter = {
    sendMagicLink: async () => {},
    signInWithPassword: async () => ({
      ok: false,
      error: "no",
      code: "invalid_credentials",
    }),
    signUp: async () => ({ ok: true }),
    startOAuth: async ({ redirectTo }) => ({ url: redirectTo }),
    userFromCookie: async () => null,
    exchangeCode: async () => null,
  };
  setDeps({
    db: await createTestDb(),
    store: createFsStore(await mkdtemp(join(tmpdir(), "sign-"))),
    auth: adapter,
    mailer: { sendMail: async () => {} },
  });
}

afterEach(() => {
  vi.mocked(docxToPdf).mockReset();
  resetDeps();
});

describe("DOCX conversion abuse resistance", () => {
  it("401s an invalid bearer before converting", { timeout: 60_000 }, async () => {
    await bootAnonDeps();
    const res = await postDocument(
      docxRequest({ authorization: "Bearer totally-invalid" }),
    );
    expect(res.status).toBe(401);
    expect(docxToPdf).not.toHaveBeenCalled();
  });

  it("collapses rotating cookies from one IP into one conversion bucket", { timeout: 120_000 }, async () => {
    await bootAnonDeps();
    vi.mocked(docxToPdf).mockResolvedValue(new Uint8Array(await minimalPdf()));
    for (let i = 0; i < 10; i++) {
      const res = await postDocument(
        docxRequest({ cookie: `junk=${i}`, "x-real-ip": "203.0.113.9" }),
      );
      expect(res.status).toBe(201);
    }
    const limited = await postDocument(
      docxRequest({ cookie: "junk=11", "x-real-ip": "203.0.113.9" }),
    );
    expect(limited.status).toBe(429);
    const json = (await limited.json()) as { code: string };
    expect(json.code).toBe("rate_limited");
    expect(docxToPdf).toHaveBeenCalledTimes(10);

    // A different proxy-reported IP is its own bucket.
    const other = await postDocument(
      docxRequest({ cookie: "junk=12", "x-real-ip": "203.0.113.10" }),
    );
    expect(other.status).toBe(201);
  });
});
