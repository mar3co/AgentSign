import { createHmac } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { POST as postDocument } from "../../app/v1/documents/route.js";
import { POST as postOtp } from "../../app/v1/documents/[id]/otp/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { auditEvents, documents } from "../db/schema.js";
import { setDeps } from "../lib/deps.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { createFsStore } from "../lib/storage.js";
import { getSigningState } from "../routes/signing.js";
import {
  fireAgentWebhook,
  newWebhookSecret,
  sealWebhookSecret,
  webhookUrlError,
} from "../lib/webhooks.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

type FetchCall = { url: string; init: RequestInit };

function header(init: RequestInit, name: string): string | null {
  const h = init.headers;
  if (!h) return null;
  if (h instanceof Headers) return h.get(name);
  if (Array.isArray(h)) {
    const row = h.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return row?.[1] ?? null;
  }
  const rec = h as Record<string, string>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? rec[key]! : null;
}

async function startVerified(opts: {
  webhookUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  failFetch?: boolean;
  fields?: unknown;
  values?: unknown;
}) {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const sent: { to: string; subject: string; text: string }[] = [];
  const posts: FetchCall[] = [];
  const sleeps: number[] = [];
  const now = opts.now ?? (() => new Date());
  const fakeFetch: typeof fetch = async (input, init) => {
    posts.push({ url: String(input), init: init ?? {} });
    if (opts.failFetch) throw new Error("webhook down");
    return new Response("ok", { status: 200 });
  };
  setDeps({
    db,
    store,
    mailer: {
      sendMail: async (m) => {
        sent.push(m);
      },
    },
    now,
    fetch: opts.fetch ?? fakeFetch,
    p12: makeDevP12("test"),
    p12Passphrase: "test",
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    // Skip real webhook retry backoff so retry tests stay fast.
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", "Repair authorization");
  body.set("sender_email", "shop@example.com");
  body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  if (opts.webhookUrl) body.set("webhook_url", opts.webhookUrl);
  if (opts.fields !== undefined) body.set("fields", JSON.stringify(opts.fields));
  if (opts.values !== undefined) body.set("values", JSON.stringify(opts.values));
  const res = await postDocument(
    new Request("http://sign.test/v1/documents", { method: "POST", body }),
  );
  return { db, store, sent, posts, sleeps, res, now };
}

async function verifyAndSign(
  id: string,
  sent: { to: string; subject: string; text: string }[],
) {
  const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
  const verify = await postOtp(
    new Request(`http://sign.test/v1/documents/${id}/otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(verify.status).toBe(200);
  const done = (await verify.json()) as {
    id: string;
    key: string;
    signers: { email: string; sign_url: string | null }[];
  };
  const token = done.signers[0]!.sign_url!.replace(/^\/s\//, "");
  const consent = await postConsent(
    new Request(`http://sign.test/s/${token}/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ consent: true }),
    }),
    { params: Promise.resolve({ token }) },
  );
  expect(consent.status).toBe(200);
  const pngBody = new FormData();
  pngBody.set("png", new Blob([png], { type: "image/png" }), "sig.png");
  const sign = await postSign(
    new Request(`http://sign.test/s/${token}/sign`, { method: "POST", body: pngBody }),
    { params: Promise.resolve({ token }) },
  );
  return { done, sign };
}

describe("document.completed webhook", () => {
  it(
    "create with https hook returns a secret and complete fires one signed POST",
    { timeout: 60_000 },
    async () => {
      const frozen = new Date("2026-08-20T12:00:00Z");
      const { db, sent, posts, res } = await startVerified({
        webhookUrl: "https://example.com/hook",
        now: () => frozen,
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as {
        id: string;
        webhook_secret?: string;
      };
      expect(created.webhook_secret).toBeTruthy();
      expect(typeof created.webhook_secret).toBe("string");
      const [row] = await db.select().from(documents).where(eq(documents.id, created.id));
      expect(row!.webhookUrl).toBe("https://example.com/hook");
      expect(row!.webhookSecretHash).not.toBe(created.webhook_secret);
      expect(row!.webhookSecretHash).toMatch(/^enc:/);
      expect(row!.webhookSecretHash).not.toContain(created.webhook_secret);

      const { done, sign } = await verifyAndSign(created.id, sent);
      expect(sign.status).toBe(200);
      const completed = posts.filter((p) =>
        String(p.init.body).includes('"document.completed"'),
      );
      expect(completed).toHaveLength(1);
      expect(completed[0]!.url).toBe("https://example.com/hook");
      expect(completed[0]!.init.method).toBe("POST");

      const signerDone = posts.filter((p) =>
        String(p.init.body).includes('"signer.completed"'),
      );
      expect(signerDone).toHaveLength(1);
      const signerRaw = String(signerDone[0]!.init.body);
      const signerPayload = JSON.parse(signerRaw) as Record<string, unknown>;
      expect(signerPayload).toMatchObject({
        event: "signer.completed",
        id: created.id,
        status: "completed",
        kind: "human",
        signer_email: "jane@example.com",
      });
      expect("sign_url" in signerPayload).toBe(false);
      expect(signerRaw).not.toContain(done.key);
      expect(signerRaw).not.toContain(done.signers[0]!.sign_url);
      expect(signerRaw).not.toContain(created.webhook_secret);
      const signerTs = header(signerDone[0]!.init, "X-Sign-Timestamp");
      const signerSig = header(signerDone[0]!.init, "X-Sign-Signature");
      const signerExpected = createHmac("sha256", created.webhook_secret!)
        .update(`${signerTs}.${signerRaw}`)
        .digest("hex");
      expect(signerSig).toBe(`sha256=${signerExpected}`);

      const rawBody = String(completed[0]!.init.body);
      const payload = JSON.parse(rawBody) as Record<string, unknown>;
      expect(payload.event).toBe("document.completed");
      expect(payload.id).toBe(created.id);
      expect(payload.status).toBe("completed");
      expect(payload.sha256).toBeTruthy();
      expect(payload.shred_at).toBe(
        new Date(frozen.getTime() + 7 * 86_400_000).toISOString(),
      );
      expect("sign_url" in payload).toBe(false);
      expect("key" in payload).toBe(false);
      expect("webhook_secret" in payload).toBe(false);
      expect(rawBody).not.toContain(done.key);
      expect(rawBody).not.toContain(done.signers[0]!.sign_url);
      expect(rawBody).not.toContain(created.webhook_secret);

      const timestamp = header(completed[0]!.init, "X-Sign-Timestamp");
      const signature = header(completed[0]!.init, "X-Sign-Signature");
      expect(timestamp).toBe(String(Math.floor(frozen.getTime() / 1000)));
      const expected = createHmac("sha256", created.webhook_secret!)
        .update(`${timestamp}.${rawBody}`)
        .digest("hex");
      expect(signature).toBe(`sha256=${expected}`);

      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.documentId, created.id));
      expect(events.some((e) => e.event === "webhook_sent")).toBe(true);
      expect(events.some((e) => e.event === "webhook_failed")).toBe(false);
    },
  );

  it("rejects http://127.0.0.1/ on create with 400", async () => {
    const { res } = await startVerified({ webhookUrl: "http://127.0.0.1/" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBeTruthy();
  });

  it(
    "rejects https loopback, localhost, and private webhook URLs with 400",
    { timeout: 60_000 },
    async () => {
      for (const url of [
        "https://127.0.0.1/hook",
        "https://localhost/hook",
        "https://192.168.0.1/hook",
      ]) {
        const { res } = await startVerified({ webhookUrl: url });
        expect(res.status, url).toBe(400);
        const json = (await res.json()) as { error: string; code: string };
        expect(json.error, url).toBeTruthy();
        expect(json.code, url).toBeTruthy();
      }
    },
  );

  it(
    "webhook fetch failure keeps document completed and audits webhook_failed once",
    { timeout: 60_000 },
    async () => {
      const { db, sent, posts, sleeps, res } = await startVerified({
        webhookUrl: "https://example.com/hook",
        failFetch: true,
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: string; webhook_secret: string };
      const { sign } = await verifyAndSign(created.id, sent);
      expect(sign.status).toBe(200);
      const signed = (await sign.json()) as { status: string };
      expect(signed.status).toBe("completed");
      const [env] = await db.select().from(documents).where(eq(documents.id, created.id));
      expect(env!.status).toBe("completed");
      const completed = posts.filter((p) =>
        String(p.init.body).includes('"document.completed"'),
      );
      // A network error is retried with backoff, three attempts in all.
      expect(completed).toHaveLength(3);
      // Each event delivery backs off 250ms then 750ms before its retries;
      // two events went out during this flow.
      expect(sleeps).toEqual([250, 750, 250, 750]);
      // Retries carry the same signature so a receiver can dedupe on it.
      const signatures = new Set(
        completed.map((p) => new Headers(p.init.headers).get("x-sign-signature")),
      );
      expect(signatures.size).toBe(1);
      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.documentId, created.id));
      const failed = events.find((e) => e.event === "webhook_failed");
      expect((failed!.payload as Record<string, unknown>).attempts).toBe(3);
      expect(events.some((e) => e.event === "webhook_sent")).toBe(false);
    },
  );

  it("rejects IPv6 loopback, mapped IPv4, and ULA webhook URLs", async () => {
    for (const url of [
      "https://[::1]/hook",
      "https://[::ffff:127.0.0.1]/hook",
      "https://[::ffff:10.0.0.1]/hook",
      "https://[::ffff:169.254.169.254]/hook",
      "https://[fc00::1]/hook",
      "https://[fe80::1]/hook",
    ]) {
      expect(await webhookUrlError(url), url).toBeTruthy();
    }
  });

  it("rejects expanded IPv6 loopback", async () => {
    expect(await webhookUrlError("https://[0:0:0:0:0:0:0:1]/hook")).toBeTruthy();
  });

  it("rejects a hostname that resolves to loopback", async () => {
    setDeps({
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    expect(await webhookUrlError("https://evil.example/hook")).toBeTruthy();
  });

  it(
    "document.completed webhook includes field values and not sign_url",
    { timeout: 60_000 },
    async () => {
      const frozen = new Date("2026-08-20T12:00:00Z");
      const { sent, posts, res } = await startVerified({
        webhookUrl: "https://example.com/hook",
        now: () => frozen,
        fields: [
          {
            name: "Full Name",
            type: "text",
            role: "Signer 1",
            required: true,
            readonly: false,
            areas: [{ page: 1, x: 10, y: 80, w: 40, h: 8 }],
          },
        ],
        values: { "Full Name": "Jane Doe" },
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as {
        id: string;
        webhook_secret: string;
      };

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
      const token = done.signers[0]!.sign_url!.replace(/^\/s\//, "");
      expect(
        (
          await postConsent(
            new Request(`http://sign.test/s/${token}/consent`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ consent: true }),
            }),
            { params: Promise.resolve({ token }) },
          )
        ).status,
      ).toBe(200);
      const pngBody = new FormData();
      pngBody.set("png", new Blob([png], { type: "image/png" }), "sig.png");
      pngBody.set("values", JSON.stringify({ "Full Name": "Jane Doe" }));
      const sign = await postSign(
        new Request(`http://sign.test/s/${token}/sign`, {
          method: "POST",
          body: pngBody,
        }),
        { params: Promise.resolve({ token }) },
      );
      expect(sign.status).toBe(200);

      const completed = posts.filter((p) =>
        String(p.init.body).includes('"document.completed"'),
      );
      expect(completed).toHaveLength(1);
      const rawBody = String(completed[0]!.init.body);
      const payload = JSON.parse(rawBody) as {
        event: string;
        id: string;
        values?: { role: string; name: string; type: string; value: string }[];
      };
      expect(payload.event).toBe("document.completed");
      expect(payload.id).toBe(created.id);
      expect(payload.values).toEqual([
        {
          role: "Signer 1",
          name: "Full Name",
          type: "text",
          value: "Jane Doe",
        },
      ]);
      expect("sign_url" in payload).toBe(false);
      expect(rawBody).not.toContain(done.key);
      expect(rawBody).not.toContain(done.signers[0]!.sign_url);
      expect(rawBody).not.toContain(created.webhook_secret);

      const timestamp = header(completed[0]!.init, "X-Sign-Timestamp");
      const signature = header(completed[0]!.init, "X-Sign-Signature");
      const expected = createHmac("sha256", created.webhook_secret)
        .update(`${timestamp}.${rawBody}`)
        .digest("hex");
      expect(signature).toBe(`sha256=${expected}`);
    },
  );

  it("signer.completed omits unsigned optional initials", { timeout: 60_000 }, async () => {
    const { sent, posts, res } = await startVerified({
      webhookUrl: "https://example.com/hook",
      fields: [
        {
          name: "sig",
          type: "signature",
          role: "Signer 1",
          required: true,
          readonly: false,
          areas: [{ page: 1, x: 10, y: 80, w: 40, h: 10 }],
        },
        {
          name: "ini",
          type: "initials",
          role: "Signer 1",
          required: false,
          readonly: false,
          areas: [{ page: 1, x: 10, y: 60, w: 15, h: 8 }],
        },
      ],
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };
    const { sign } = await verifyAndSign(created.id, sent);
    expect(sign.status).toBe(200);

    const signerDone = posts.filter((p) =>
      String(p.init.body).includes('"signer.completed"'),
    );
    expect(signerDone).toHaveLength(1);
    const payload = JSON.parse(String(signerDone[0]!.init.body)) as {
      values?: { name: string; value: string }[];
    };
    expect(payload.values?.find((v) => v.name === "sig")?.value).toBe("[signed]");
    expect(payload.values?.some((v) => v.name === "ini")).toBe(false);
  });

  it("first open fires document.opened", { timeout: 60_000 }, async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    const { sent, posts, res } = await startVerified({
      webhookUrl: "https://example.com/hook",
      now: () => frozen,
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      webhook_secret: string;
    };
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
      signers: { email: string; sign_url: string | null }[];
    };
    const token = done.signers[0]!.sign_url!.replace(/^\/s\//, "");
    posts.length = 0;

    const first = await getSigningState(token);
    expect(first.status).toBe(200);
    expect(posts).toHaveLength(1);
    const rawBody = String(posts[0]!.init.body);
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "document.opened",
      id: created.id,
      status: "pending",
      signer_email: "jane@example.com",
    });
    expect("sign_url" in payload).toBe(false);
    expect(rawBody).not.toContain(token);
    expect(rawBody).not.toContain(created.webhook_secret);
    const timestamp = header(posts[0]!.init, "X-Sign-Timestamp");
    const signature = header(posts[0]!.init, "X-Sign-Signature");
    const expected = createHmac("sha256", created.webhook_secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    expect(signature).toBe(`sha256=${expected}`);

    posts.length = 0;
    const again = await getSigningState(token);
    expect(again.status).toBe(200);
    expect(posts).toHaveLength(0);
  });
});

describe("webhook delivery retries", () => {
  function completedCounterFetch(
    statuses: number[],
  ): { fetchMock: typeof fetch; calls: () => number } {
    let completedCalls = 0;
    const fetchMock: typeof fetch = async (_input, init) => {
      const isCompleted = String(init?.body ?? "").includes('"document.completed"');
      if (!isCompleted) return new Response("ok", { status: 200 });
      const status = statuses[completedCalls] ?? statuses[statuses.length - 1]!;
      completedCalls++;
      return new Response(status >= 200 && status < 300 ? "ok" : "err", { status });
    };
    return { fetchMock, calls: () => completedCalls };
  }

  it(
    "retries a 500 then succeeds, auditing webhook_sent with attempts=2",
    { timeout: 60_000 },
    async () => {
      const { fetchMock, calls } = completedCounterFetch([500, 200]);
      const { db, sent, res } = await startVerified({
        webhookUrl: "https://example.com/hook",
        fetch: fetchMock,
      });
      const created = (await res.json()) as { id: string };
      const { sign } = await verifyAndSign(created.id, sent);
      expect(sign.status).toBe(200);
      expect(calls()).toBe(2);
      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.documentId, created.id));
      // document.completed and signer.completed both audit webhook_sent for
      // this document; match on attempts=2 to pick out the retried one.
      const sentEvent = events.find(
        (e) =>
          e.event === "webhook_sent" &&
          (e.payload as Record<string, unknown> | null)?.attempts === 2,
      );
      expect(sentEvent).toBeTruthy();
      expect(events.some((e) => e.event === "webhook_failed")).toBe(false);
    },
  );

  it("does not retry a 400 response", { timeout: 60_000 }, async () => {
    const { fetchMock, calls } = completedCounterFetch([400]);
    const { db, sent, res } = await startVerified({
      webhookUrl: "https://example.com/hook",
      fetch: fetchMock,
    });
    const created = (await res.json()) as { id: string };
    const { sign } = await verifyAndSign(created.id, sent);
    expect(sign.status).toBe(200);
    expect(calls()).toBe(1);
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.documentId, created.id));
    const failedEvent = events.find(
      (e) =>
        e.event === "webhook_failed" &&
        (e.payload as Record<string, unknown> | null)?.status === 400,
    );
    expect(failedEvent).toBeTruthy();
    expect((failedEvent!.payload as Record<string, unknown>).attempts).toBe(1);
  });

  it(
    "retries three times on repeated 503s and records attempts=3",
    { timeout: 60_000 },
    async () => {
      const { fetchMock, calls } = completedCounterFetch([503, 503, 503]);
      const { db, sent, res } = await startVerified({
        webhookUrl: "https://example.com/hook",
        fetch: fetchMock,
      });
      const created = (await res.json()) as { id: string };
      const { sign } = await verifyAndSign(created.id, sent);
      expect(sign.status).toBe(200);
      expect(calls()).toBe(3);
      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.documentId, created.id));
      const failedEvent = events.find(
        (e) =>
          e.event === "webhook_failed" &&
          (e.payload as Record<string, unknown> | null)?.status === 503,
      );
      expect(failedEvent).toBeTruthy();
      expect((failedEvent!.payload as Record<string, unknown>).attempts).toBe(3);
    },
  );

  it("retries a 429 response", { timeout: 60_000 }, async () => {
    const { fetchMock, calls } = completedCounterFetch([429, 200]);
    const { db, sent, res } = await startVerified({
      webhookUrl: "https://example.com/hook",
      fetch: fetchMock,
    });
    const created = (await res.json()) as { id: string };
    const { sign } = await verifyAndSign(created.id, sent);
    expect(sign.status).toBe(200);
    expect(calls()).toBe(2);
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.documentId, created.id));
    const sentEvent = events.find(
      (e) =>
        e.event === "webhook_sent" &&
        (e.payload as Record<string, unknown> | null)?.attempts === 2,
    );
    expect(sentEvent).toBeTruthy();
  });
});

describe("per-agent webhooks", () => {
  it("fireAgentWebhook HMAC sha256= verifies and omits secrets", async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    const posts: FetchCall[] = [];
    setDeps({
      now: () => frozen,
      fetch: async (input, init) => {
        posts.push({ url: String(input), init: init ?? {} });
        return new Response("ok", { status: 200 });
      },
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    const secret = newWebhookSecret();
    await fireAgentWebhook(
      {
        webhookUrl: "https://example.com/agent-hook",
        webhookSecretHash: sealWebhookSecret(secret),
      },
      {
        event: "party.ready",
        id: "11111111-1111-1111-1111-111111111111",
        agent: "grok-legal",
        status: "pending",
      },
    );
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("https://example.com/agent-hook");
    expect(posts[0]!.init.method).toBe("POST");
    const rawBody = String(posts[0]!.init.body);
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    expect(payload).toEqual({
      event: "party.ready",
      id: "11111111-1111-1111-1111-111111111111",
      agent: "grok-legal",
      status: "pending",
    });
    expect(rawBody).not.toContain(secret);
    expect(rawBody).not.toMatch(/sign_agent_/);
    expect("sign_url" in payload).toBe(false);
    expect("webhook_secret" in payload).toBe(false);
    const timestamp = header(posts[0]!.init, "X-Sign-Timestamp");
    const signature = header(posts[0]!.init, "X-Sign-Signature");
    expect(timestamp).toBe(String(Math.floor(frozen.getTime() / 1000)));
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    expect(signature).toBe(`sha256=${expected}`);
  });
});
