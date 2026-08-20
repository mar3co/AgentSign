// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { render, screen } from "@testing-library/react";
import { createTestDb } from "./db.js";
import { createFsStore, objectKey } from "../lib/storage.js";
import { setDeps } from "../lib/deps.js";
import { POST as postEnvelope } from "../../app/v1/envelopes/route.js";
import { POST as postOtp } from "../../app/v1/envelopes/[id]/otp/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { POST as postDecline } from "../../app/s/[token]/decline/route.js";
import { GET as getPdf } from "../../app/v1/envelopes/[id]/pdf/route.js";
import { getSigningState } from "../routes/signing.js";
import SigningPage from "../../app/s/[token]/page.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { newSigningToken } from "../lib/tokens.js";
import { minimalPdf } from "./pdf.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { accounts, documents, envelopes, signers as signersTable } from "../db/schema.js";

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
    signers: { email: string; sign_url: string | null }[];
  };
  return {
    db,
    store,
    sent,
    id: done.id,
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
    const [env] = await db.select().from(envelopes).where(eq(envelopes.id, id));
    expect(env!.status).toBe("completed");
    expect(env!.sha256).toBeTruthy();
    expect(env!.shredAt.getTime()).toBe(frozen.getTime() + 7 * 86_400_000);
    const sealed = await store.get(objectKey(id, "sealed"));
    expect(sealed).not.toBeNull();
    expect(sealed!.byteLength).toBeGreaterThan(0);
    const cert = await store.get(objectKey(id, "certificate"));
    expect(cert).not.toBeNull();
    const docs = await db.select().from(documents).where(eq(documents.envelopeId, id));
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

  it("rejects a signer token on GET envelope PDF with 401", { timeout: 30_000 }, async () => {
    const { id, token } = await startVerified();
    const res = await getPdf(
      new Request(`http://sign.test/v1/envelopes/${id}.pdf`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(401);
    const noAuth = await getPdf(
      new Request(`http://sign.test/v1/envelopes/${id}.pdf`),
      { params: Promise.resolve({ id }) },
    );
    expect(noAuth.status).toBe(401);
  });

  it("decline sets envelope declined and finish returns 409", { timeout: 30_000 }, async () => {
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
    const [env] = await db.select().from(envelopes).where(eq(envelopes.id, id));
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
    expect(seq.signers[1]!.sign_url == null || seq.signers[1]!.sign_url === "").toBe(
      true,
    );
    // Defense-in-depth: if a later signer somehow has a token before prior signs, wait.
    const bobEarly = newSigningToken();
    const bobRows = await seq.db
      .select()
      .from(signersTable)
      .where(eq(signersTable.envelopeId, seq.id));
    bobRows.sort((a, b) => a.signingOrder - b.signingOrder);
    await seq.db
      .update(signersTable)
      .set({ tokenHash: bobEarly.hash })
      .where(eq(signersTable.id, bobRows[1]!.id));
    const wait = await getSigningState(bobEarly.raw);
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
    expect(screen.queryByText(/Keep it in a cabinet/i)).toBeNull();
  });

  it("leaves envelope pending and returns 500 if complete throws", { timeout: 30_000 }, async () => {
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
    const [env] = await db.select().from(envelopes).where(eq(envelopes.id, id));
    expect(env!.status).toBe("pending");
    expect(await store.get(objectKey(id, "sealed"))).toBeNull();
    const [row] = await db.select().from(signersTable).where(eq(signersTable.envelopeId, id));
    expect(row!.signedAt).toBeNull();
  });

  it("sets shred_at from PRO_KEEP_DAYS when the envelope user is pro", { timeout: 60_000 }, async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    const { db, store, id, token } = await startVerified({ now: () => frozen });
    const userId = randomUUID();
    await db.insert(accounts).values({ userId, plan: "pro" });
    await db.update(envelopes).set({ userId }).where(eq(envelopes.id, id));
    setDeps({ p12: makeDevP12("test"), p12Passphrase: "test" });
    const consent = await postConsent(consentRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(consent.status).toBe(200);
    const sign = await postSign(signRequest(token), {
      params: Promise.resolve({ token }),
    });
    expect(sign.status).toBe(200);
    const [env] = await db.select().from(envelopes).where(eq(envelopes.id, id));
    expect(env!.status).toBe("completed");
    expect(env!.shredAt.getTime()).toBe(frozen.getTime() + 365 * 86_400_000);
    expect(env!.shredAt.getTime()).not.toBe(frozen.getTime() + 7 * 86_400_000);
    expect(await store.get(objectKey(id, "sealed"))).not.toBeNull();
  });
});
