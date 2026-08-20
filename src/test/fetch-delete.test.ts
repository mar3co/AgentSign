import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./db.js";
import { createFsStore, objectKey } from "../lib/storage.js";
import { setDeps } from "../lib/deps.js";
import { POST as postEnvelope } from "../../app/v1/envelopes/route.js";
import { POST as postOtp } from "../../app/v1/envelopes/[id]/otp/route.js";
import { GET as getEnvelope, DELETE as deleteEnvelope } from "../../app/v1/envelopes/[id]/route.js";
import { GET as getPdf } from "../../app/v1/envelopes/[id]/pdf/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { minimalPdf } from "./pdf.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditEvents, documents } from "../db/schema.js";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function tokenFromUrl(signUrl: string) {
  return signUrl.replace(/^\/s\//, "");
}

async function startVerified(opts?: { now?: () => Date }) {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const sent: { to: string; subject: string; text: string }[] = [];
  const now = opts?.now ?? (() => new Date());
  setDeps({
    db,
    store,
    mailer: { sendMail: async (m) => { sent.push(m); } },
    now,
    p12: makeDevP12("test"),
    p12Passphrase: "test",
  });
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", "Repair authorization");
  body.set("sender_email", "shop@example.com");
  body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  const res = await postEnvelope(
    new Request("http://sign.test/v1/envelopes", { method: "POST", body }),
  );
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string };
  const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
  const verify = await postOtp(
    new Request(`http://sign.test/v1/envelopes/${created.id}/otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
    { params: Promise.resolve({ id: created.id }) },
  );
  expect(verify.status).toBe(200);
  const done = (await verify.json()) as {
    id: string;
    key: string;
    signers: { email: string; sign_url: string | null }[];
  };
  return {
    db,
    store,
    sent,
    id: done.id,
    key: done.key,
    token: tokenFromUrl(done.signers[0]!.sign_url!),
  };
}

function bearer(key: string, url: string, method = "GET") {
  return new Request(url, {
    method,
    headers: { authorization: `Bearer ${key}` },
  });
}

async function complete(token: string) {
  const consent = await postConsent(
    new Request(`http://sign.test/s/${token}/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent: true }),
    }),
    { params: Promise.resolve({ token }) },
  );
  expect(consent.status).toBe(200);
  const body = new FormData();
  body.set("png", new Blob([png], { type: "image/png" }), "sig.png");
  const sign = await postSign(
    new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body }),
    { params: Promise.resolve({ token }) },
  );
  expect(sign.status).toBe(200);
}

describe("GET/DELETE envelope", () => {
  it("GET status with tmp key works; GET pdf is 409 before complete", { timeout: 30_000 }, async () => {
    const { id, key } = await startVerified();
    const status = await getEnvelope(
      bearer(key, `http://sign.test/v1/envelopes/${id}`),
      { params: Promise.resolve({ id }) },
    );
    expect(status.status).toBe(200);
    const json = (await status.json()) as {
      id: string;
      status: string;
      title: string;
      expires_at: string;
      shred_at: string;
      signers: { email: string }[];
      audit: { event: string; at: string }[];
    };
    expect(json.id).toBe(id);
    expect(json.status).toBe("pending");
    expect(json.title).toBe("Repair authorization");
    expect(json.expires_at).toBeTruthy();
    expect(json.shred_at).toBeTruthy();
    expect(json.signers[0]!.email).toBe("jane@example.com");
    expect(json.audit.some((a) => a.event === "email_verified")).toBe(true);
    expect(JSON.stringify(json)).not.toMatch(/sign_tmp_/);
    expect(JSON.stringify(json)).not.toMatch(/\/s\//);

    const pdf = await getPdf(
      bearer(key, `http://sign.test/v1/envelopes/${id}.pdf`),
      { params: Promise.resolve({ id }) },
    );
    expect(pdf.status).toBe(409);
    const err = (await pdf.json()) as { error: string; code: string };
    expect(err.error).toBeTruthy();
    expect(err.code).toBeTruthy();
  });

  it("GET pdf 200 after complete with tmp key", { timeout: 60_000 }, async () => {
    const { store, id, key, token } = await startVerified();
    await complete(token);
    const pdf = await getPdf(
      bearer(key, `http://sign.test/v1/envelopes/${id}.pdf`),
      { params: Promise.resolve({ id }) },
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toMatch(/application\/pdf/);
    const body = new Uint8Array(await pdf.arrayBuffer());
    const sealed = await store.get(objectKey(id, "sealed"));
    expect(sealed).not.toBeNull();
    expect(Array.from(body)).toEqual(Array.from(sealed!));
  });

  it("DELETE purges blobs, GET pdf 410, audit row remains", { timeout: 60_000 }, async () => {
    const { db, store, id, key, token } = await startVerified();
    await complete(token);
    expect(await store.get(objectKey(id, "sealed"))).not.toBeNull();

    const del = await deleteEnvelope(
      bearer(key, `http://sign.test/v1/envelopes/${id}`, "DELETE"),
      { params: Promise.resolve({ id }) },
    );
    expect(del.status).toBe(200);

    expect(await store.get(objectKey(id, "original"))).toBeNull();
    expect(await store.get(objectKey(id, "sealed"))).toBeNull();
    expect(await store.get(objectKey(id, "certificate"))).toBeNull();

    const pdf = await getPdf(
      bearer(key, `http://sign.test/v1/envelopes/${id}.pdf`),
      { params: Promise.resolve({ id }) },
    );
    expect(pdf.status).toBe(410);
    const err = (await pdf.json()) as { error: string; code: string };
    expect(err.error).toBeTruthy();
    expect(err.code).toBeTruthy();

    const status = await getEnvelope(
      bearer(key, `http://sign.test/v1/envelopes/${id}`),
      { params: Promise.resolve({ id }) },
    );
    expect(status.status).toBe(401);

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.envelopeId, id));
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.some((a) => a.event === "deleted")).toBe(true);
    expect(audits.some((a) => a.event === "signed" || a.event === "email_verified")).toBe(
      true,
    );

    const docs = await db.select().from(documents).where(eq(documents.envelopeId, id));
    expect(docs.every((d) => !d.storagePath)).toBe(true);
  });
});
