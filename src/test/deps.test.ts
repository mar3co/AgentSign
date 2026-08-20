import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POST as postEnvelope } from "../../app/v1/envelopes/route.js";
import { resetEnvCache } from "../env.js";
import { resolveStoreFromEnv, setDeps } from "../lib/deps.js";
import { objectKey } from "../lib/storage.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
) {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const next = vars[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  resetEnvCache();
  try {
    await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key]!;
    }
    resetEnvCache();
  }
}

describe("BlobStore composition root", () => {
  it("resolveStoreFromEnv uses STORAGE_DIR and skips live Supabase under Vitest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sign-deps-"));
    try {
      await withEnv({ STORAGE_DIR: dir }, async () => {
        const store = resolveStoreFromEnv();
        expect(store).toBeTruthy();
        await store!.put("k", new Uint8Array([9, 8, 7]));
        expect(Array.from((await store!.get("k"))!)).toEqual([9, 8, 7]);
      });
      await withEnv(
        {
          STORAGE_DIR: undefined,
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key",
        },
        async () => {
          expect(resolveStoreFromEnv()).toBeUndefined();
        },
      );
      await withEnv(
        {
          STORAGE_DIR: undefined,
          SUPABASE_URL: undefined,
          SUPABASE_SERVICE_ROLE_KEY: undefined,
        },
        async () => {
          expect(resolveStoreFromEnv()).toBeUndefined();
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("POST /v1/envelopes is 201 when store is unset and STORAGE_DIR is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sign-fallback-"));
    const db = await createTestDb();
    const sent: { to: string }[] = [];
    await withEnv({ STORAGE_DIR: dir }, async () => {
      setDeps({
        db,
        store: undefined,
        mailer: { sendMail: async (m) => { sent.push(m); } },
      });
      const pdf = await minimalPdf();
      const body = new FormData();
      body.set("title", "Repair authorization");
      body.set("sender_email", "shop@example.com");
      body.set(
        "signers",
        JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
      );
      body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
      const res = await postEnvelope(
        new Request("http://sign.test/v1/envelopes", { method: "POST", body }),
      );
      expect(res.status).toBe(201);
      const json = (await res.json()) as { id: string; status: string };
      expect(json.status).toBe("pending_sender");
      const fallback = resolveStoreFromEnv();
      expect(await fallback!.get(objectKey(json.id, "original"))).not.toBeNull();
      expect(sent[0]!.to).toBe("shop@example.com");
    });
    await rm(dir, { recursive: true, force: true });
  });

  it("POST /v1/envelopes is 503 JSON when store and storage env are unset", async () => {
    const db = await createTestDb();
    await withEnv(
      {
        STORAGE_DIR: undefined,
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
      },
      async () => {
        setDeps({
          db,
          store: undefined,
          mailer: { sendMail: async () => {} },
        });
        const pdf = await minimalPdf();
        const body = new FormData();
        body.set("title", "Repair authorization");
        body.set("sender_email", "shop@example.com");
        body.set(
          "signers",
          JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
        );
        body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
        const res = await postEnvelope(
          new Request("http://sign.test/v1/envelopes", { method: "POST", body }),
        );
        expect(res.status).toBe(503);
        const json = (await res.json()) as { error: string; code: string };
        expect(json.error).toBeTruthy();
        expect(json.code).toBe("storage_unconfigured");
      },
    );
  });
});
