import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "./db.js";
import { createFsStore } from "../lib/storage.js";
import { setDeps } from "../lib/deps.js";
import { POST as postEnvelope } from "../../app/v1/envelopes/route.js";
import { POST as postOtp } from "../../app/v1/envelopes/[id]/otp/route.js";
import { POST as postConsent } from "../../app/s/[token]/consent/route.js";
import { POST as postSign } from "../../app/s/[token]/sign/route.js";
import { makeDevP12 } from "../lib/pdf/devP12.js";
import { minimalPdf } from "./pdf.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditEvents, signers as signersTable } from "../db/schema.js";
import { createMailer, type MailMessage } from "../lib/email.js";
import { resetEnvCache } from "../env.js";
import { getSigningState } from "../routes/signing.js";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function tokenFromUrl(signUrl: string) {
  return signUrl.replace(/^\/s\//, "");
}

async function startFlow(opts?: {
  signers?: { name: string; email: string }[];
  now?: () => Date;
}) {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const sent: MailMessage[] = [];
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
  return { db, store, sent, id: created.id, code, now };
}

async function verifyOtp(id: string, code: string) {
  const verify = await postOtp(
    new Request(`http://sign.test/v1/envelopes/${id}/otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(verify.status).toBe(200);
  return (await verify.json()) as {
    id: string;
    signers: { email: string; sign_url: string | null }[];
  };
}

function consentRequest(token: string) {
  return new Request(`http://sign.test/s/${token}/consent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "test-ua",
      "x-forwarded-for": "1.2.3.4",
    },
    body: JSON.stringify({ consent: true }),
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

describe("email templates", () => {
  it("sends signer invite on OTP verify", { timeout: 30_000 }, async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    const { sent, id, code } = await startFlow({ now: () => frozen });
    const before = sent.length;
    const done = await verifyOtp(id, code);

    const invites = sent.slice(before).filter((m) => m.to === "jane@example.com");
    expect(invites.length).toBe(1);
    const invite = invites[0]!;
    expect(done.signers[0]!.sign_url).toMatch(/^\/s\//);
    expect(invite.text).toContain(`http://localhost:3000${done.signers[0]!.sign_url}`);
    expect(invite.text).toContain("shop@example.com");
    expect(invite.text).toContain("Repair authorization");
    expect(invite.text).toMatch(/2026-08-27/);
    expect(invite.text).toMatch(/If you were not expecting this, contact the sender/i);
    expect(invite.text).not.toMatch(/create an account/i);
    expect(invite.text).not.toMatch(/sign up/i);
    expect(invite.text).not.toMatch(/\/login/i);
  });

  it(
    "completion mail includes shred sentence, attachments, and cabinet CTA",
    { timeout: 60_000 },
    async () => {
      const frozen = new Date("2026-08-20T12:00:00Z");
      const { db, sent, id, code } = await startFlow({ now: () => frozen });
      const done = await verifyOtp(id, code);
      const token = tokenFromUrl(done.signers[0]!.sign_url);

      const consent = await postConsent(consentRequest(token), {
        params: Promise.resolve({ token }),
      });
      expect(consent.status).toBe(200);
      const before = sent.length;
      const sign = await postSign(signRequest(token), {
        params: Promise.resolve({ token }),
      });
      expect(sign.status).toBe(200);
      const shredAt = new Date(frozen.getTime() + 7 * 86_400_000).toISOString();

      const completion = sent
        .slice(before)
        .filter((m) => m.text.includes("Download this. We delete it on "));
      expect(completion.length).toBeGreaterThanOrEqual(2);
      for (const mail of completion) {
        expect(mail.text).toContain(`Download this. We delete it on ${shredAt}`);
        expect(mail.text).toContain("Keep it in a cabinet");
        expect(mail.text).toContain(
          `http://localhost:3000/login?email=${encodeURIComponent(mail.to)}&next=/envelopes`,
        );
        expect(mail.text).toContain("Keep this a year");
        expect(mail.text).toContain("http://localhost:3000/upgrade");
        expect(mail.attachments).toBeDefined();
        expect(mail.attachments).toHaveLength(2);
        const names = mail.attachments!.map((a) => a.filename).sort();
        expect(names).toEqual(["certificate.pdf", "signed.pdf"]);
        for (const a of mail.attachments!) {
          expect(a.bytes.byteLength).toBeGreaterThan(0);
        }
      }
      expect(completion.some((m) => m.to === "jane@example.com")).toBe(true);
      expect(completion.some((m) => m.to === "shop@example.com")).toBe(true);

      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.envelopeId, id));
      expect(events.some((e) => e.event === "emailed")).toBe(true);
    },
  );

  it("invites only the next sequential signer after prior signs", { timeout: 60_000 }, async () => {
    const frozen = new Date("2026-08-20T12:00:00Z");
    const { db, sent, id, code } = await startFlow({
      now: () => frozen,
      signers: [
        { name: "Jane", email: "jane@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ],
    });
    const done = await verifyOtp(id, code);
    expect(sent.some((m) => m.to === "jane@example.com")).toBe(true);
    expect(sent.some((m) => m.to === "bob@example.com")).toBe(false);

    expect(done.signers).toHaveLength(2);
    expect(done.signers[0]!.email).toBe("jane@example.com");
    expect(done.signers[0]!.sign_url).toMatch(/^\/s\//);
    expect(done.signers[1]!.email).toBe("bob@example.com");
    expect(done.signers[1]!.sign_url == null || done.signers[1]!.sign_url === "").toBe(
      true,
    );

    const janeUrl = done.signers[0]!.sign_url!;
    const jane = tokenFromUrl(janeUrl);
    const rowsBefore = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.envelopeId, id));
    rowsBefore.sort((a, b) => a.signingOrder - b.signingOrder);
    const janeHashBefore = rowsBefore[0]!.tokenHash;

    const opened = await getSigningState(jane);
    expect(opened.status).toBe(200);

    await postConsent(consentRequest(jane), { params: Promise.resolve({ token: jane }) });
    const before = sent.length;
    const sign = await postSign(signRequest(jane), {
      params: Promise.resolve({ token: jane }),
    });
    expect(sign.status).toBe(200);

    const bobInvites = sent.slice(before).filter((m) => m.to === "bob@example.com");
    expect(bobInvites.length).toBe(1);
    const bobMatch = bobInvites[0]!.text.match(/\/s\/([A-Za-z0-9_-]+)/);
    expect(bobMatch).toBeTruthy();
    const bobToken = bobMatch![1]!;
    expect(bobInvites[0]!.text).toMatch(/If you were not expecting this, contact the sender/i);

    const bobState = await getSigningState(bobToken);
    expect(bobState.status).toBe(200);

    const rows = await db
      .select()
      .from(signersTable)
      .where(eq(signersTable.envelopeId, id));
    rows.sort((a, b) => a.signingOrder - b.signingOrder);
    expect(rows[0]!.sentAt).not.toBeNull();
    expect(rows[1]!.sentAt).not.toBeNull();
    expect(rows[0]!.tokenHash).toBe(janeHashBefore);
  });

  it("dev mailer does not log OTP digits or signing URLs", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const mailer = createMailer();
      await mailer.sendMail({
        to: "shop@example.com",
        subject: "Your Sign code",
        text: "Your verification code is 123456. Sign at http://localhost:3000/s/tokensecret",
      });
      const dumped = spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(dumped).not.toContain("123456");
      expect(dumped).not.toContain("tokensecret");
      expect(dumped).not.toContain("/s/");
    } finally {
      spy.mockRestore();
    }
  });

  it("Resend JSON includes html and attachment content_id when present", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.FROM_EMAIL = "sign@localhost";
    resetEnvCache();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const prev = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const mailer = createMailer();
      await mailer.sendMail({
        to: "jane@example.com",
        subject: "Please sign",
        text: "Shop Co (shop@example.com) asked you to sign.",
        html: "<p>Shop Co</p>",
        attachments: [
          { filename: "logo.png", bytes: png, contentId: "brand-logo" },
        ],
      });
      expect(fetchMock).toHaveBeenCalled();
      const [, init] = fetchMock.mock.calls[0]!;
      const body = JSON.parse(String((init as RequestInit).body)) as {
        html?: string;
        attachments?: { content_id?: string }[];
      };
      expect(body.html).toBe("<p>Shop Co</p>");
      expect(body.attachments?.[0]?.content_id).toBe("brand-logo");
    } finally {
      globalThis.fetch = prev;
      delete process.env.RESEND_API_KEY;
      resetEnvCache();
    }
  });
});
