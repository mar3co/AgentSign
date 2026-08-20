import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./db.js";
import { createFsStore, objectKey } from "../lib/storage.js";
import { setDeps } from "../lib/deps.js";
import { POST as postEnvelope } from "../../app/v1/envelopes/route.js";
import { POST as postOtp } from "../../app/v1/envelopes/[id]/otp/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { remindDue, shredDue } from "../jobs/shred.js";
import { GET as getShred } from "../../app/internal/shred/route.js";
import { getSigningState } from "../routes/signing.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { minimalPdf } from "./pdf.js";
import { resetEnvCache } from "../env.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  apiKeys,
  auditEvents,
  envelopes,
  signers as signersTable,
} from "../db/schema.js";
import type { MailMessage } from "../lib/email.js";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const DAY = 86_400_000;

function tokenFromUrl(signUrl: string) {
  return signUrl.replace(/^\/s\//, "");
}

function inviteMails(sent: MailMessage[]) {
  return sent.filter((m) => /^Please sign:/i.test(m.subject));
}

function reminderMails(sent: MailMessage[]) {
  return sent.filter(
    (m) => /already sent/i.test(m.text) || /^Reminder/i.test(m.subject),
  );
}

function mailsTo(sent: MailMessage[], email: string) {
  return sent.filter((m) => m.to === email);
}

async function startEnvelope(opts: {
  now: () => Date;
  signers?: { name: string; email: string }[];
  title?: string;
  sender?: string;
}) {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const sent: MailMessage[] = [];
  const mailer = { sendMail: async (m: MailMessage) => { sent.push(m); } };
  setDeps({
    db,
    store,
    mailer,
    now: opts.now,
    p12: makeDevP12("test"),
    p12Passphrase: "test",
  });
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", opts.title ?? "Repair authorization");
  body.set("sender_email", opts.sender ?? "shop@example.com");
  body.set(
    "signers",
    JSON.stringify(opts.signers ?? [{ name: "Jane", email: "jane@example.com" }]),
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
    key: string;
    signers: { email: string; sign_url: string | null }[];
  };
  return {
    db,
    store,
    sent,
    mailer,
    id: done.id,
    key: done.key,
    token: tokenFromUrl(done.signers[0]!.sign_url!),
  };
}

async function addVerified(
  sent: MailMessage[],
  opts?: {
    title?: string;
    sender?: string;
    signers?: { name: string; email: string }[];
  },
) {
  const before = sent.length;
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", opts?.title ?? "Repair authorization");
  body.set("sender_email", opts?.sender ?? "shop@example.com");
  body.set(
    "signers",
    JSON.stringify(opts?.signers ?? [{ name: "Jane", email: "jane@example.com" }]),
  );
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  const res = await postEnvelope(
    new Request("http://sign.test/v1/envelopes", { method: "POST", body }),
  );
  expect(res.status).toBe(201);
  const created = (await res.json()) as { id: string };
  const code = sent[before]!.text.match(/\b(\d{6})\b/)![1]!;
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
    id: done.id,
    token: tokenFromUrl(done.signers[0]!.sign_url!),
  };
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

async function signerHash(db: Awaited<ReturnType<typeof createTestDb>>, envelopeId: string) {
  const [row] = await db
    .select()
    .from(signersTable)
    .where(eq(signersTable.envelopeId, envelopeId));
  return row!;
}

describe("remindDue and shredDue", () => {
  it("reminds a pending signer after 3 days, not again before +3d, skips completed", { timeout: 60_000 }, async () => {
    let at = new Date("2026-08-20T12:00:00Z");
    const pending = await startEnvelope({ now: () => at });
    const hashBefore = (await signerHash(pending.db, pending.id)).tokenHash;
    const completed = await startEnvelope({
      now: () => at,
      sender: "other@example.com",
      signers: [{ name: "Bob", email: "bob@example.com" }],
      title: "Completed job",
    });
    await complete(completed.token);
    const completedInvitesBefore = inviteMails(completed.sent).length;

    at = new Date(at.getTime() + 3 * DAY);
    await remindDue(pending.db, pending.mailer, at);
    await remindDue(completed.db, completed.mailer, at);

    const reminders = reminderMails(pending.sent);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.to).toBe("jane@example.com");
    expect(reminders[0]!.text).toContain("Repair authorization");
    expect(reminders[0]!.text).toContain("shop@example.com");
    expect(reminders[0]!.text).toContain("2026-08-27");
    expect(reminders[0]!.text).toMatch(/already sent/i);
    expect(reminders[0]!.text).toContain("http://localhost:3000/");
    expect(reminders[0]!.text).not.toMatch(/\/s\//);

    const reminded = await signerHash(pending.db, pending.id);
    expect(reminded.remindedAt).not.toBeNull();
    expect(reminded.remindedAt!.getTime()).toBe(at.getTime());
    expect(reminded.tokenHash).toBe(hashBefore);

    setDeps({
      db: pending.db,
      store: pending.store,
      mailer: pending.mailer,
      now: () => at,
    });
    const opened = await getSigningState(pending.token);
    expect(opened.status).toBe(200);

    await remindDue(pending.db, pending.mailer, at);
    expect(reminderMails(pending.sent)).toHaveLength(1);

    expect(inviteMails(completed.sent).length).toBe(completedInvitesBefore);
  });

  it("sends at most two reminders", { timeout: 60_000 }, async () => {
    let at = new Date("2026-08-20T12:00:00Z");
    const pending = await startEnvelope({ now: () => at });
    await pending.db
      .update(envelopes)
      .set({ expiresAt: new Date(at.getTime() + 30 * DAY) })
      .where(eq(envelopes.id, pending.id));
    const hashBefore = (await signerHash(pending.db, pending.id)).tokenHash;
    const janeBefore = mailsTo(pending.sent, "jane@example.com").length;

    at = new Date(at.getTime() + 3 * DAY);
    await remindDue(pending.db, pending.mailer, at);
    expect(mailsTo(pending.sent, "jane@example.com").length).toBe(janeBefore + 1);
    expect(reminderMails(pending.sent)).toHaveLength(1);

    at = new Date(at.getTime() + 3 * DAY);
    await remindDue(pending.db, pending.mailer, at);
    expect(mailsTo(pending.sent, "jane@example.com").length).toBe(janeBefore + 2);
    expect(reminderMails(pending.sent)).toHaveLength(2);

    at = new Date(at.getTime() + 3 * DAY);
    await remindDue(pending.db, pending.mailer, at);
    expect(mailsTo(pending.sent, "jane@example.com").length).toBe(janeBefore + 2);
    expect(reminderMails(pending.sent)).toHaveLength(2);

    const row = await signerHash(pending.db, pending.id);
    expect(row.tokenHash).toBe(hashBefore);
    const audits = await pending.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.envelopeId, pending.id));
    expect(audits.filter((a) => a.event === "reminded")).toHaveLength(2);

    setDeps({
      db: pending.db,
      store: pending.store,
      mailer: pending.mailer,
      now: () => at,
    });
    expect((await getSigningState(pending.token)).status).toBe(200);
  });

  it("GET /internal/shred requires CRON_SECRET and runs shredDue + remindDue", { timeout: 60_000 }, async () => {
    let at = new Date("2026-08-20T12:00:00Z");
    const ctx = await startEnvelope({ now: () => at });
    const second = await addVerified(ctx.sent, {
      sender: "other@example.com",
      signers: [{ name: "Bob", email: "bob@example.com" }],
      title: "Completed job",
    });
    await complete(second.token);
    await ctx.db
      .update(envelopes)
      .set({ shredAt: new Date(at.getTime() + 3 * DAY) })
      .where(eq(envelopes.id, second.id));

    const prev = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = "";
      resetEnvCache();
      const noAuth = await getShred(new Request("http://sign.test/internal/shred"));
      expect(noAuth.status).toBe(401);
      const body = (await noAuth.json()) as { error: string; code: string };
      expect(body.error).toBeTruthy();
      expect(body.code).toBeTruthy();

      process.env.CRON_SECRET = "test-cron-secret";
      resetEnvCache();
      const wrong = await getShred(
        new Request("http://sign.test/internal/shred", {
          headers: { authorization: "Bearer wrong-secret" },
        }),
      );
      expect(wrong.status).toBe(401);

      at = new Date(at.getTime() + 3 * DAY);
      setDeps({
        db: ctx.db,
        store: ctx.store,
        mailer: ctx.mailer,
        now: () => at,
      });
      const remindedBefore = reminderMails(ctx.sent).length;
      const ok = await getShred(
        new Request("http://sign.test/internal/shred", {
          headers: { authorization: "Bearer test-cron-secret" },
        }),
      );
      expect(ok.status).toBe(200);

      const reminded = await signerHash(ctx.db, ctx.id);
      expect(reminded.remindedAt).not.toBeNull();
      expect(reminderMails(ctx.sent).length).toBe(remindedBefore + 1);

      const [env] = await ctx.db.select().from(envelopes).where(eq(envelopes.id, second.id));
      expect(env!.status).toBe("deleted");
      expect(await ctx.store.get(objectKey(second.id, "sealed"))).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
      resetEnvCache();
    }
  });

  it("shredDue after shred_at purges blobs and tombstones", { timeout: 60_000 }, async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    let at = frozen;
    const { db, store, id, token } = await startEnvelope({ now: () => at });
    await complete(token);

    expect(await store.get(objectKey(id, "original"))).not.toBeNull();
    expect(await store.get(objectKey(id, "sealed"))).not.toBeNull();
    expect(await store.get(objectKey(id, "certificate"))).not.toBeNull();

    const [before] = await db.select().from(envelopes).where(eq(envelopes.id, id));
    expect(before!.status).toBe("completed");
    expect(before!.shredAt.getTime()).toBe(frozen.getTime() + 7 * DAY);

    at = before!.shredAt;
    await shredDue(db, store, at);

    expect(await store.get(objectKey(id, "original"))).toBeNull();
    expect(await store.get(objectKey(id, "sealed"))).toBeNull();
    expect(await store.get(objectKey(id, "certificate"))).toBeNull();

    const [env] = await db.select().from(envelopes).where(eq(envelopes.id, id));
    expect(env!.status).toBe("deleted");
    expect(env!.senderEmail).toBe("redacted");
    const [signer] = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.envelopeId, id));
    expect(signer!.email).toBe("redacted");

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.envelopeId, id));
    expect(audits.some((a) => a.event === "deleted")).toBe(true);
    expect(audits.some((a) => a.event === "signed")).toBe(true);

    const keys = await db.select().from(apiKeys).where(eq(apiKeys.envelopeId, id));
    expect(keys).toHaveLength(1);
    expect(keys[0]!.kind).toBe("tmp");
    expect(keys[0]!.expiresAt.getTime()).toBeLessThanOrEqual(at.getTime());
  });
});
