import { describe, it, expect } from "vitest";
import { createTestDb } from "./db.js";
import { createFsStore } from "../lib/storage.js";
import { setDeps } from "../lib/deps.js";
import { POST as postEnvelope } from "../../app/v1/envelopes/route.js";
import { POST as postOtp } from "../../app/v1/envelopes/[id]/otp/route.js";
import { minimalPdf } from "./pdf.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { otpChallenges } from "../db/schema.js";

describe("POST /v1/envelopes", () => {
  it("one-off send is pending_sender until OTP", async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    setDeps({
      db,
      store,
      mailer: { sendMail: async (m) => { sent.push(m); } },
    });
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair authorization");
    body.set("sender_email", "shop@example.com");
    body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const res = await postEnvelope(new Request("http://sign.test/v1/envelopes", { method: "POST", body }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.status).toBe("pending_sender");
    expect(sent[0]!.to).toBe("shop@example.com");
    const code = sent[0]!.text.match(/\b(\d{6})\b/)![1]!;
    const verify = await postOtp(
      new Request(`http://sign.test/v1/envelopes/${json.id}/otp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
      { params: Promise.resolve({ id: json.id }) },
    );
    expect(verify.status).toBe(200);
    const done = await verify.json();
    expect(done.status).toBe("pending");
    expect(done.key).toMatch(/^sign_tmp_/);
    expect(done.signers[0].sign_url).toMatch(/^\/s\//);
    const leaked = await db.select().from(otpChallenges);
    expect(JSON.stringify(leaked)).not.toContain(code);
    expect(JSON.stringify(leaked)).not.toContain(done.key);
  });

  it("returns 429 after the free send cap for a sender_email", { timeout: 60_000 }, async () => {
    const db = await createTestDb();
    const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
    const sent: { to: string; subject: string; text: string }[] = [];
    const frozen = new Date("2026-08-20T12:00:00Z");
    setDeps({
      db,
      store,
      mailer: { sendMail: async (m) => { sent.push(m); } },
      now: () => frozen,
    });
    const pdf = await minimalPdf();
    async function postOnce() {
      const body = new FormData();
      body.set("title", "Repair authorization");
      body.set("sender_email", "cap@example.com");
      body.set("signers", JSON.stringify([{ name: "Jane", email: "jane@example.com" }]));
      body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
      return postEnvelope(new Request("http://sign.test/v1/envelopes", { method: "POST", body }));
    }
    for (let i = 0; i < 20; i++) {
      const res = await postOnce();
      expect(res.status).toBe(201);
    }
    const over = await postOnce();
    expect(over.status).toBe(429);
    const json = await over.json();
    expect(json.error).toBeTruthy();
    expect(json.code).toBeTruthy();
    expect(JSON.stringify(json)).not.toMatch(/20/);
  });
});
