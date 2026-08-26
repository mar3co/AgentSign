// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { cleanup, render, screen } from "@testing-library/react";
import { createTestDb } from "./db.js";
import { createFsStore, objectKey } from "../lib/storage.js";
import { setDeps } from "../lib/deps.js";
import { POST as postDocument } from "../../app/v1/documents/route.js";
import { POST as postOtp } from "../../app/v1/documents/[id]/otp/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { POST as postDecline } from "../../app/s/[token]/decline/route.js";
import { GET as getPdf } from "../../app/v1/documents/[id]/pdf/route.js";
import { GET as getCeremonyPdf } from "../../app/s/[token]/pdf/route.js";
import { getSigningState, inviteNextHumanIfNeeded } from "../routes/signing.js";
import { SigningCeremony } from "../../app/s/[token]/signing-ceremony.js";
import { PDFDocument } from "pdf-lib";
import SigningPage from "../../app/s/[token]/page.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { sha256Hex } from "../lib/hash.js";
import { minimalPdf } from "./pdf.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { accounts, files, documents, signers as signersTable } from "../db/schema.js";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function tokenFromUrl(signUrl: string) {
  return signUrl.replace(/^\/s\//, "");
}

async function startVerified(opts?: {
  signers?: { name: string; email: string }[];
  now?: () => Date;
}) {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const sent: { to: string; subject: string; text: string }[] = [];
  const now = opts?.now ?? (() => new Date());
  setDeps({
    db,
    store,
    mailer: { sendMail: async (m) => { sent.push(m); } },
    now,
  });
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", "Repair authorization");
  body.set("sender_email", "shop@example.com");
  body.set(
    "signers",
    JSON.stringify(
      opts?.signers ?? [{ name: "Jane", email: "jane@example.com" }],
    ),
  );
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  const res = await postDocument(
    new Request("http://sign.test/v1/documents", { method: "POST", body }),
  );
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string };
  const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
  const verify = await postOtp(
    new Request(`http://sign.test/v1/documents/${created.id}/otp`, {
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
    signers: done.signers,
    tokens: done.signers
      .filter((s) => s.sign_url)
      .map((s) => tokenFromUrl(s.sign_url!)),
    token: tokenFromUrl(done.signers[0]!.sign_url!),
  };
}

function consentRequest(token: string, body: unknown = { consent: true }) {
  return new Request(`http://sign.test/s/${token}/consent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "test-ua",
      "x-forwarded-for": "1.2.3.4",
    },
    body: JSON.stringify(body),
  });
}

function signRequest(token: string) {
  const body = new FormData();
  body.set("png", new Blob([png], { type: "image/png" }), "sig.png");
  return new Request(`http://sign.test/s/${token}/sign`, {
    method: "POST",
    headers: {
      "user-agent": "test-ua",
      "x-forwarded-for": "1.2.3.4",
    },
    body,
  });
}

describe("signing ceremony", () => {
  afterEach(() => {
    cleanup();
  });

  it("consent then sign completes and stores a sealed blob", { timeout: 60_000 }, async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    const { db, store, id, token } = await startVerified({ now: () => frozen });
    setDeps({ p12: makeDevP12("test"), p12Passphrase: "test" });

    const state = await getSigningState(token);
    expect(state.status).toBe(200);
    const json = (await state.json()) as {
      title: string;
      signerName: string;
      sequentialWait: boolean;
      expiresAt: string;
    };
    expect(json.title).toBe("Repair authorization");
    expect(json.signerName).toBe("Jane");
    expect(json.sequentialWait).toBe(false);
    expect((json as { status?: string }).status).toBe("pending");

    const consent = await postConsent(consentRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(consent.status).toBe(200);
    const [consented] = await db.select().from(signersTable);
    expect(consented!.consentedAt).not.toBeNull();
    expect(consented!.consentUa).toBe("test-ua");
    expect(consented!.ip).toBe("1.2.3.4");

    const sign = await postSign(signRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(sign.status).toBe(200);
    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("completed");
    expect(env!.sha256).toBeTruthy();
    expect(env!.shredAt.getTime()).toBe(frozen.getTime() + 7 * 86_400_000);
    const sealed = await store.get(objectKey(id, "sealed"));
    expect(sealed).not.toBeNull();
    expect(sealed!.byteLength).toBeGreaterThan(0);
    const cert = await store.get(objectKey(id, "certificate"));
    expect(cert).not.toBeNull();
    const docs = await db.select().from(files).where(eq(files.documentId, id));
    expect(docs.some((d) => d.kind === "sealed")).toBe(true);
    expect(docs.some((d) => d.kind === "certificate")).toBe(true);
  });

  it("rejects sign without consent with 400", { timeout: 30_000 }, async () => {
    const { token } = await startVerified();
    const sign = await postSign(signRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(sign.status).toBe(400);
  });

  it("rejects a signer token on GET document PDF with 401", { timeout: 30_000 }, async () => {
    const { id, token } = await startVerified();
    const res = await getPdf(
      new Request(`http://sign.test/v1/documents/${id}.pdf`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(401);
    const noAuth = await getPdf(
      new Request(`http://sign.test/v1/documents/${id}.pdf`),
      { params: Promise.resolve({ id }) },
    );
    expect(noAuth.status).toBe(401);
  });

  it("decline sets document declined and finish returns 409", { timeout: 30_000 }, async () => {
    const { db, id, token, sent } = await startVerified();
    const before = sent.length;
    const decline = await postDecline(
      new Request(`http://sign.test/s/${token}/decline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "No thanks" }),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(decline.status).toBe(200);
    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("declined");
    const [row] = await db.select().from(signersTable);
    expect(row!.declinedAt).not.toBeNull();
    expect(sent.length).toBeGreaterThan(before);
    expect(sent.some((m) => /declin/i.test(m.subject) || /declin/i.test(m.text))).toBe(true);
    expect(sent[sent.length - 1]!.to).toBe("shop@example.com");

    const finish = await postSign(signRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(finish.status).toBe(409);
  });

  it("unknown token is 404, expired is 410, sequential wait is 409", { timeout: 30_000 }, async () => {
    const db = await createTestDb();
    setDeps({
      db,
      store: createFsStore(await mkdtemp(join(tmpdir(), "sign-"))),
      mailer: { sendMail: async () => {} },
    });
    const missing = await getSigningState("not-a-real-token");
    expect(missing.status).toBe(404);

    let at = new Date("2026-08-20T12:00:00Z");
    const expired = await startVerified({ now: () => at });
    const opened = await getSigningState(expired.token);
    expect(opened.status).toBe(200);
    const [first] = await expired.db.select().from(signersTable);
    const openedAt = first!.openedAt!.getTime();
    at = new Date(at.getTime() + 60_000);
    await getSigningState(expired.token);
    const [again] = await expired.db.select().from(signersTable);
    expect(again!.openedAt!.getTime()).toBe(openedAt);

    at = new Date(at.getTime() + 8 * 86_400_000);
    const gone = await getSigningState(expired.token);
    expect(gone.status).toBe(410);

    const seq = await startVerified({
      signers: [
        { name: "Jane", email: "jane@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ],
    });
    expect(seq.signers[0]!.sign_url).toMatch(/^\/s\//);
    expect(seq.signers[1]!.sign_url).toMatch(/^\/s\//);
    // Later humans already have a token; sequential wait still 409 until prior signs.
    const bobEarly = tokenFromUrl(seq.signers[1]!.sign_url!);
    const wait = await getSigningState(bobEarly);
    expect(wait.status).toBe(409);
    const body = (await wait.json()) as { error: string };
    expect(body.error).toBe("Waiting on previous signer.");
  });

  it("renders checkbox, canvas, Finish, and Decline", { timeout: 30_000 }, async () => {
    const { token } = await startVerified();
    const ui = await SigningPage({ params: Promise.resolve({ token }) });
    render(ui);
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(document.querySelector("canvas")).toBeTruthy();
    expect(screen.getByRole("button", { name: /finish/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /decline/i })).toBeTruthy();
    expect(screen.queryByText(/Keep it in your documents/i)).toBeNull();
  });

  it("unknown token page uses a Not found heading", { timeout: 30_000 }, async () => {
    const db = await createTestDb();
    setDeps({
      db,
      store: createFsStore(await mkdtemp(join(tmpdir(), "sign-"))),
    });
    const ui = await SigningPage({ params: Promise.resolve({ token: "missing" }) });
    render(ui);
    expect(screen.getByRole("heading", { name: /not found/i })).toBeTruthy();
  });

  it("leaves document pending and returns 500 if complete throws", { timeout: 30_000 }, async () => {
    const { db, store, id, token } = await startVerified();
    setDeps({ p12: Buffer.from("not-a-pkcs12"), p12Passphrase: "nope" });
    const consent = await postConsent(consentRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(consent.status).toBe(200);
    const sign = await postSign(signRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(sign.status).toBe(500);
    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("pending");
    expect(await store.get(objectKey(id, "sealed"))).toBeNull();
    const [row] = await db.select().from(signersTable).where(eq(signersTable.documentId, id));
    expect(row!.signedAt).toBeNull();
  });

  it("sets shred_at from PRO_KEEP_DAYS when the document user is pro", { timeout: 60_000 }, async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    const { db, store, id, token } = await startVerified({ now: () => frozen });
    const userId = randomUUID();
    await db.insert(accounts).values({ userId, plan: "pro" });
    await db.update(documents).set({ userId }).where(eq(documents.id, id));
    setDeps({ p12: makeDevP12("test"), p12Passphrase: "test" });
    const consent = await postConsent(consentRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(consent.status).toBe(200);
    const sign = await postSign(signRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(sign.status).toBe(200);
    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("completed");
    expect(env!.shredAt.getTime()).toBe(frozen.getTime() + 365 * 86_400_000);
    expect(env!.shredAt.getTime()).not.toBe(frozen.getTime() + 7 * 86_400_000);
    expect(await store.get(objectKey(id, "sealed"))).not.toBeNull();
  });

  it("sets shred_at from PRO_KEEP_DAYS when a signer account is pro", { timeout: 60_000 }, async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    const { db, id, token } = await startVerified({ now: () => frozen });
    const userId = randomUUID();
    await db.insert(accounts).values({
      userId,
      email: "jane@example.com",
      plan: "pro",
    });
    setDeps({ p12: makeDevP12("test"), p12Passphrase: "test" });
    expect(
      (await postConsent(consentRequest(token), { params: Promise.resolve({ token }) })).status,
    ).toBe(200);
    expect(
      (await postSign(signRequest(token), { params: Promise.resolve({ token }) })).status,
    ).toBe(200);
    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.shredAt.getTime()).toBe(frozen.getTime() + 365 * 86_400_000);
  });

  it("tmp key still fetches the PDF after a late complete until shred_at", { timeout: 60_000 }, async () => {
    let at = new Date("2026-08-20T12:00:00Z");
    const { id, token, key } = await startVerified({ now: () => at });
    setDeps({ p12: makeDevP12("test"), p12Passphrase: "test" });
    at = new Date(at.getTime() + 6 * 86_400_000);
    const consent = await postConsent(consentRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(consent.status).toBe(200);
    const sign = await postSign(signRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(sign.status).toBe(200);
    at = new Date(at.getTime() + 2 * 86_400_000);
    const pdf = await getPdf(
      new Request(`http://sign.test/v1/documents/${id}/pdf`, {
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(pdf.status).toBe(200);
    at = new Date(at.getTime() + 6 * 86_400_000);
    const gone = await getPdf(
      new Request(`http://sign.test/v1/documents/${id}/pdf`, {
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(gone.status).toBeGreaterThanOrEqual(400);
  });

  it("completion mail throw still returns 200 completed", { timeout: 60_000 }, async () => {
    let failMail = false;
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    setDeps({
      db,
      store,
      mailer: {
        sendMail: async (m) => {
          if (failMail) throw new Error("resend down");
          sent.push(m);
        },
      },
      p12: makeDevP12("test"),
      p12Passphrase: "test",
    });
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const created = await postDocument(
      new Request("http://sign.test/v1/documents", { method: "POST", body }),
    );
    const { id } = (await created.json()) as { id: string };
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const verify = await postOtp(
      new Request(`http://sign.test/v1/documents/${id}/otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
      { params: Promise.resolve({ id }) },
    );
    const done = (await verify.json()) as {
      signers: { sign_url: string | null }[];
    };
    const token = tokenFromUrl(done.signers[0]!.sign_url!);
    await postConsent(consentRequest(token), { params: Promise.resolve({ token }) });
    failMail = true;
    const sign = await postSign(signRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(sign.status).toBe(200);
    const json = (await sign.json()) as { status: string };
    expect(json.status).toBe("completed");
    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("completed");
  });

  it("guessable pending:{id}:{index} token is not a signing link", { timeout: 30_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    setDeps({
      db,
      store,
      mailer: { sendMail: async () => {} },
    });
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const created = await postDocument(
      new Request("http://sign.test/v1/documents", { method: "POST", body }),
    );
    const { id } = (await created.json()) as { id: string };
    const guess = await getSigningState(`pending:${id}:0`);
    expect(guess.status).toBe(404);
  });

  it("two sequential signers each appear on the sealed PDF", { timeout: 60_000 }, async () => {
    const { store, id, token, sent } = await startVerified({
      signers: [
        { name: "Jane", email: "jane@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ],
    });
    setDeps({ p12: makeDevP12("test"), p12Passphrase: "test" });
    expect(
      (await postConsent(consentRequest(token), { params: Promise.resolve({ token }) })).status,
    ).toBe(200);
    const before = sent.length;
    expect(
      (await postSign(signRequest(token), { params: Promise.resolve({ token }) })).status,
    ).toBe(200);
    const bobInvites = sent.slice(before).filter((m) => m.to === "bob@example.com");
    const bobMatch = bobInvites[0]!.text.match(/\/s\/([A-Za-z0-9_-]+)/);
    const bob = bobMatch![1]!;
    expect(
      (await postConsent(consentRequest(bob), { params: Promise.resolve({ token: bob }) })).status,
    ).toBe(200);
    expect(
      (await postSign(signRequest(bob), { params: Promise.resolve({ token: bob }) })).status,
    ).toBe(200);
    const sealed = await store.get(objectKey(id, "sealed"));
    const sealedDoc = await PDFDocument.load(sealed!);
    expect(sealedDoc.getPageCount()).toBe(3);
  });

  it("ceremony GET /s/:token/pdf returns sealed after complete; signer token still 401 on /v1 pdf", { timeout: 60_000 }, async () => {
    const { id, token } = await startVerified();
    const early = await getCeremonyPdf(
      new Request(`http://sign.test/s/${token}/pdf`),
      { params: Promise.resolve({ token }) },
    );
    expect(early.status).toBeGreaterThanOrEqual(400);
    setDeps({ p12: makeDevP12("test"), p12Passphrase: "test" });
    expect(
      (await postConsent(consentRequest(token), { params: Promise.resolve({ token }) })).status,
    ).toBe(200);
    expect(
      (await postSign(signRequest(token), { params: Promise.resolve({ token }) })).status,
    ).toBe(200);
    const pdf = await getCeremonyPdf(
      new Request(`http://sign.test/s/${token}/pdf`),
      { params: Promise.resolve({ token }) },
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toMatch(/pdf/);
    const v1 = await getPdf(
      new Request(`http://sign.test/v1/documents/${id}/pdf`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(v1.status).toBe(401);
  });

  it("done screen Download is a link to the ceremony PDF", () => {
    render(
      createElement(SigningCeremony, {
        token: "tok_1",
        consentText: "I agree",
        state: {
          title: "Repair authorization",
          signerName: "Jane",
          signerEmail: "jane@example.com",
          sequentialWait: false,
          expiresAt: new Date().toISOString(),
          shredAt: new Date().toISOString(),
          signed: true,
          status: "completed",
        },
      }),
    );
    const link = screen.getByRole("link", { name: /download/i });
    expect(link.getAttribute("href")).toBe("/s/tok_1/pdf");
    expect(screen.getByRole("link", { name: /certificate/i }).getAttribute("href")).toBe(
      "/s/tok_1/pdf?kind=certificate",
    );
  });

  it("non-last signer done screen has no Download", () => {
    render(
      createElement(SigningCeremony, {
        token: "tok_mid",
        consentText: "I agree",
        state: {
          title: "Repair authorization",
          signerName: "Jane",
          signerEmail: "jane@example.com",
          sequentialWait: false,
          expiresAt: new Date().toISOString(),
          shredAt: new Date().toISOString(),
          signed: true,
          status: "pending",
        },
      }),
    );
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
    expect(screen.getByText(/next signer/i)).toBeTruthy();
  });

  it("decline mail throw still returns 200 declined", { timeout: 60_000 }, async () => {
    const { token, db } = await startVerified();
    await postConsent(consentRequest(token), { params: Promise.resolve({ token }) });
    setDeps({
      mailer: { sendMail: async () => { throw new Error("resend down"); } },
    });
    const res = await postDecline(
      new Request(`http://sign.test/s/${token}/decline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string }).toMatchObject({ status: "declined" });
    const [env] = await db.select().from(documents);
    expect(env!.status).toBe("declined");
  });

  it("rejects a non-PNG appearance before signed_at", { timeout: 60_000 }, async () => {
    const { token, db } = await startVerified();
    await postConsent(consentRequest(token), { params: Promise.resolve({ token }) });
    const body = new FormData();
    body.set("png", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }), "sig.png");
    const res = await postSign(
      new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_png");
    const [signer] = await db.select().from(signersTable);
    expect(signer!.signedAt).toBeNull();
  });

  it("sequential invite mail throw leaves Jane unsigned so Finish can retry", { timeout: 60_000 }, async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const { token, db, id } = await startVerified({
      signers: [
        { name: "Jane", email: "jane@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ],
    });
    setDeps({
      mailer: {
        sendMail: async (m) => {
          if (/please sign/i.test(m.subject) && /bob@example.com/i.test(m.to)) {
            throw new Error("resend down");
          }
          sent.push(m);
        },
      },
    });
    await postConsent(consentRequest(token), { params: Promise.resolve({ token }) });
    const sign = await postSign(signRequest(token), { params: Promise.resolve({ token }) });
    expect(sign.status).toBe(503);
    const rows = await db.select().from(signersTable).where(eq(signersTable.documentId, id));
    rows.sort((a, b) => a.signingOrder - b.signingOrder);
    expect(rows[0]!.signedAt).toBeNull();
    expect(rows[1]!.sentAt).toBeNull();
  });

  it("GET ceremony and REST PDF serve the sibling certificate", { timeout: 60_000 }, async () => {
    const { id, token, key } = await startVerified();
    setDeps({ p12: makeDevP12("test"), p12Passphrase: "test" });
    await postConsent(consentRequest(token), { params: Promise.resolve({ token }) });
    const signed = await postSign(signRequest(token), { params: Promise.resolve({ token }) });
    expect(signed.status).toBe(200);
    const cert = await getCeremonyPdf(
      new Request(`http://sign.test/s/${token}/pdf?kind=certificate`),
      { params: Promise.resolve({ token }) },
    );
    expect(cert.status).toBe(200);
    expect(cert.headers.get("content-type")).toMatch(/pdf/);
    const rest = await getPdf(
      new Request(`http://sign.test/v1/documents/${id}/pdf?kind=certificate`, {
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(rest.status).toBe(200);
    const bytes = Buffer.from(await rest.arrayBuffer());
    expect(bytes.includes(Buffer.from("Certificate of completion"))).toBe(true);
  });

  it("second last-signer Finish does not overwrite the committed sealed PDF", { timeout: 60_000 }, async () => {
    const { db, store, id, token } = await startVerified();
    setDeps({ p12: makeDevP12("test"), p12Passphrase: "test" });
    expect(
      (await postConsent(consentRequest(token), { params: Promise.resolve({ token }) })).status,
    ).toBe(200);

    const innerGet = store.get.bind(store);
    let nested = false;
    let nestedRes: Response | undefined;
    setDeps({
      store: {
        put: store.put.bind(store),
        delete: store.delete.bind(store),
        async get(key: string) {
          const val = await innerGet(key);
          if (key === objectKey(id, "original") && !nested) {
            nested = true;
            nestedRes = await postSign(signRequest(token), {
              params: Promise.resolve({ token }),
            });
          }
          return val;
        },
      },
    });

    const first = await postSign(signRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(nestedRes).toBeDefined();
    const statuses = [first.status, nestedRes!.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("completed");
    const sealed = await innerGet(objectKey(id, "sealed"));
    expect(sealed).not.toBeNull();
    expect(sha256Hex(sealed!)).toBe(env!.sha256);
  });

  it("decline after a concurrent complete leaves the document completed", { timeout: 60_000 }, async () => {
    const { db, store, id, token } = await startVerified();
    setDeps({ p12: makeDevP12("test"), p12Passphrase: "test" });
    expect(
      (await postConsent(consentRequest(token), { params: Promise.resolve({ token }) })).status,
    ).toBe(200);

    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    const body = new ReadableStream({
      async pull(controller) {
        await held;
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const declineP = postDecline(
      new Request(`http://sign.test/s/${token}/decline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit),
      { params: Promise.resolve({ token }) },
    );
    await new Promise((r) => setTimeout(r, 50));
    const signed = await postSign(signRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(signed.status).toBe(200);
    release();
    const decline = await declineP;
    expect(decline.status).toBe(409);
    const [env] = await db.select().from(documents).where(eq(documents.id, id));
    expect(env!.status).toBe("completed");
    const sealed = await store.get(objectKey(id, "sealed"));
    expect(sealed).not.toBeNull();
    expect(sha256Hex(sealed!)).toBe(env!.sha256);
  });

  it("concurrent first-signer Finish mails the next signer once", { timeout: 60_000 }, async () => {
    const { db, store, id, token, sent } = await startVerified({
      signers: [
        { name: "Jane", email: "jane@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ],
    });
    expect(
      (await postConsent(consentRequest(token), { params: Promise.resolve({ token }) })).status,
    ).toBe(200);

    const innerPut = store.put.bind(store);
    let nested = false;
    let nestedRes: Response | undefined;
    setDeps({
      store: {
        get: store.get.bind(store),
        delete: store.delete.bind(store),
        async put(key: string, bytes: Uint8Array) {
          if (key.includes("/appearance/") && !nested) {
            nested = true;
            await innerPut(key, bytes);
            nestedRes = await postSign(signRequest(token), {
              params: Promise.resolve({ token }),
            });
            return;
          }
          return innerPut(key, bytes);
        },
      },
    });

    const first = await postSign(signRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(nestedRes).toBeDefined();
    const statuses = [first.status, nestedRes!.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
    const bobInvites = sent.filter((m) => m.to === "bob@example.com");
    expect(bobInvites).toHaveLength(1);
    const rows = await db.select().from(signersTable).where(eq(signersTable.documentId, id));
    rows.sort((a, b) => a.signingOrder - b.signingOrder);
    expect(rows[0]!.signedAt).not.toBeNull();
    expect(rows[1]!.sentAt).not.toBeNull();
  });

  it("inviteNextHumanIfNeeded claims sent_at before mailing a minted token", {
    timeout: 60_000,
  }, async () => {
    const { db, sent, id } = await startVerified({
      signers: [
        { name: "Jane", email: "jane@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ],
    });
    const allSigners = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.documentId, id));
    allSigners.sort((a, b) => a.signingOrder - b.signingOrder);
    expect(allSigners[1]!.tokenEnc).toBeTruthy();
    expect(allSigners[1]!.sentAt).toBeNull();
    const [document] = await db.select().from(documents).where(eq(documents.id, id));
    const before = sent.filter((m) => m.to === "bob@example.com").length;
    const at = new Date();
    await Promise.all([
      inviteNextHumanIfNeeded(db, document!, allSigners, allSigners[0]!, at, async () => {}),
      inviteNextHumanIfNeeded(db, document!, allSigners, allSigners[0]!, at, async () => {}),
    ]);
    expect(sent.filter((m) => m.to === "bob@example.com")).toHaveLength(before + 1);
    const [bob] = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.id, allSigners[1]!.id));
    expect(bob!.sentAt).not.toBeNull();
  });
});
