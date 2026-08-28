import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST as postDocument } from "../../app/v1/documents/route.js";
import { GET as getPdf } from "../../app/v1/documents/[id]/pdf/route.js";
import { POST as postOtp } from "../../app/v1/documents/[id]/otp/route.js";
import { documents, files } from "../db/schema.js";
import { purgeDocument } from "../jobs/shred.js";
import { resetDeps, setDeps } from "../lib/deps.js";
import { createFsStore, objectKey } from "../lib/storage.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

type Harness = {
  db: Awaited<ReturnType<typeof createTestDb>>;
  store: ReturnType<typeof createFsStore>;
  sent: { to: string; subject: string; text: string }[];
};

async function harness(): Promise<Harness> {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const sent: Harness["sent"] = [];
  setDeps({
    db,
    store,
    mailer: {
      sendMail: async (m) => {
        sent.push(m);
      },
    },
    now: () => new Date(),
  });
  return { db, store, sent };
}

/** Send markdown, verify the sender OTP, return the tmp key. */
async function verifiedMarkdownSend(
  h: Harness,
  markdown: string,
): Promise<{ id: string; key: string }> {
  const res = await send(markdownForm(markdown));
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const code = h.sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
  const verify = await postOtp(
    new Request(`http://sign.test/v1/documents/${id}/otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(verify.status).toBe(200);
  const { key } = (await verify.json()) as { key: string };
  return { id, key };
}

function markdownForm(markdown: string | null, file?: Blob): FormData {
  const body = new FormData();
  body.set("title", "Service agreement");
  body.set("sender_email", "shop@example.com");
  body.set(
    "signers",
    JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
  );
  if (markdown != null) body.set("markdown", markdown);
  if (file) body.set("file", file, "doc.pdf");
  return body;
}

function send(body: FormData): Promise<Response> {
  return postDocument(
    new Request("http://sign.test/v1/documents", { method: "POST", body }),
  );
}

afterEach(() => {
  resetDeps();
});

describe("POST /v1/documents with markdown", () => {
  it("renders markdown, stores original PDF plus source, and parses {{sig}} tags", async () => {
    const { db, store } = await harness();
    const markdown =
      "# Service Agreement\n\nSign below to accept.\n\n{{sig}}";
    const res = await send(markdownForm(markdown));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row!.fields.some((f) => f.type === "signature")).toBe(true);

    const fileRows = await db.select().from(files).where(eq(files.documentId, id));
    const kinds = fileRows.map((f) => f.kind).sort();
    expect(kinds).toEqual(["original", "source"]);

    const original = await store.get(objectKey(id, "original"));
    expect(original).toBeTruthy();
    expect(new TextDecoder().decode(original!.slice(0, 5))).toBe("%PDF-");

    const source = await store.get(objectKey(id, "source"));
    expect(source).toBeTruthy();
    expect(new TextDecoder().decode(source!)).toBe(markdown);
  });

  it("uploads store no source file", async () => {
    const { db } = await harness();
    const res = await send(markdownForm(null, new Blob([await minimalPdf()], { type: "application/pdf" })));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const fileRows = await db.select().from(files).where(eq(files.documentId, id));
    expect(fileRows.map((f) => f.kind)).toEqual(["original"]);
  });

  it("rejects a request with both file and markdown", async () => {
    await harness();
    const res = await send(
      markdownForm("# Hi", new Blob([await minimalPdf()], { type: "application/pdf" })),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_request");
  });

  it("rejects empty markdown", async () => {
    await harness();
    const res = await send(markdownForm("   \n  "));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_markdown");
  });

  it("rejects markdown over the byte cap", async () => {
    await harness();
    const res = await send(markdownForm(`# Big\n\n${"x".repeat(1024 * 1024)}`));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("markdown_too_large");
  });

  it("serves the source markdown before completion via ?kind=source", async () => {
    const h = await harness();
    const markdown = "# NDA\n\nKeep it secret.\n\n{{sig}}";
    const { id, key } = await verifiedMarkdownSend(h, markdown);
    const res = await getPdf(
      new Request(`http://sign.test/v1/documents/${id}/pdf?kind=source`, {
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toBe(markdown);
  });

  it("404s ?kind=source for a document sent as a PDF", async () => {
    const h = await harness();
    const res = await send(
      markdownForm(null, new Blob([await minimalPdf()], { type: "application/pdf" })),
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const code = h.sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const verify = await postOtp(
      new Request(`http://sign.test/v1/documents/${id}/otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
      { params: Promise.resolve({ id }) },
    );
    const { key } = (await verify.json()) as { key: string };
    const res2 = await getPdf(
      new Request(`http://sign.test/v1/documents/${id}/pdf?kind=source`, {
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res2.status).toBe(404);
  });

  it("shreds the source blob with the document", async () => {
    const h = await harness();
    const { id } = await verifiedMarkdownSend(h, "# NDA\n\n{{sig}}");
    expect(await h.store.get(objectKey(id, "source"))).toBeTruthy();
    await purgeDocument(h.db, h.store, id, new Date(), { force: true });
    expect(await h.store.get(objectKey(id, "source"))).toBeNull();
    expect(await h.store.get(objectKey(id, "original"))).toBeNull();
  });
});
