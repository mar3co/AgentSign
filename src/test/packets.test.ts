import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { POST as postEnvelope } from "../../app/v1/envelopes/route.js";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import {
  GET as listPackets,
  POST as postPacket,
} from "../../app/v1/packets/route.js";
import {
  DELETE as deletePacket,
  GET as getPacket,
  PATCH as patchPacket,
} from "../../app/v1/packets/[id]/route.js";
import { POST as sendPacket } from "../../app/v1/packets/[id]/send/route.js";
import { accounts, packets } from "../db/schema.js";
import { setDeps } from "../lib/deps.js";
import { createFsStore } from "../lib/storage.js";
import { newTmpKey } from "../lib/tokens.js";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

type AuthUser = { id: string; email: string };

type PacketJson = {
  id: string;
  title: string;
  roles: { signing_order: number; role_name: string }[];
  created_at: string;
};

function createFakeAuth() {
  const users = new Map<string, AuthUser>();
  const sessions = new Map<string, AuthUser>();
  const codes = new Map<string, AuthUser>();

  function userFor(email: string): AuthUser {
    const e = email.toLowerCase();
    let u = users.get(e);
    if (!u) {
      u = { id: randomUUID(), email: e };
      users.set(e, u);
    }
    return u;
  }

  return {
    userFor,
    adapter: {
      async sendMagicLink({ email }: { email: string }) {
        const u = userFor(email);
        codes.set(`magic:${u.email}`, u);
      },
      async signInWithPassword() {
        return {
          ok: false as const,
          error: "Invalid credentials",
          code: "invalid_credentials",
        };
      },
      async signUp() {
        return { ok: true as const };
      },
      async startOAuth({
        redirectTo,
      }: {
        provider: "google" | "github";
        redirectTo: string;
      }) {
        return { url: redirectTo };
      },
      async userFromCookie(header: string | null) {
        if (!header) return null;
        const m = header.match(/(?:^|;\s*)sign_session=([^;]+)/);
        if (!m) return null;
        return sessions.get(m[1]!) ?? null;
      },
      async exchangeCode(code: string) {
        const u = codes.get(code);
        if (!u) return null;
        const token = randomUUID();
        sessions.set(token, u);
        return {
          user: u,
          cookie: `sign_session=${token}; Path=/; HttpOnly`,
        };
      },
    },
  };
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

async function magicCookie(email: string) {
  const login = await postLogin(
    new Request("http://sign.test/login/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  expect(login.status).toBe(200);
  const cb = await getAuthCallback(
    new Request(
      `http://sign.test/auth/callback?code=${encodeURIComponent(`magic:${email.toLowerCase()}`)}`,
    ),
  );
  expect(cb.status).toBe(302);
  return cookieFrom(cb);
}

async function boot() {
  const db = await createTestDb();
  const store = createFsStore(await mkdtemp(join(tmpdir(), "sign-")));
  const { adapter, userFor } = createFakeAuth();
  const sent: { to: string; subject: string; text: string }[] = [];
  setDeps({
    db,
    store,
    auth: adapter,
    mailer: {
      sendMail: async (m) => {
        sent.push(m);
      },
    },
  });
  return { db, store, userFor, sent };
}

async function asPro(
  db: Awaited<ReturnType<typeof createTestDb>>,
  userFor: (email: string) => AuthUser,
  email = "shop@example.com",
) {
  const cookie = await magicCookie(email);
  const userId = userFor(email).id;
  await db
    .update(accounts)
    .set({ plan: "pro" })
    .where(eq(accounts.userId, userId));
  return { cookie, userId };
}

async function packetForm(title = "Repair packet") {
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", title);
  body.set("roles", JSON.stringify([{ role_name: "Customer" }]));
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  return { body, pdf };
}

function packetCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("packets API", () => {
  it("free session POST packet is 403 pro_required", async () => {
    await boot();
    const cookie = await magicCookie("shop@example.com");
    const { body } = await packetForm();
    const res = await postPacket(
      new Request("http://sign.test/v1/packets", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("pro_required");
  });

  it("pro POST multipart PDF then GET list and GET id", { timeout: 60_000 }, async () => {
    const { db, store, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const { body, pdf } = await packetForm();
    const created = await postPacket(
      new Request("http://sign.test/v1/packets", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    expect(created.status).toBe(201);
    const packet = (await created.json()) as PacketJson;
    expect(packet.id).toBeTruthy();
    expect(packet.title).toBe("Repair packet");
    expect(packet.roles).toEqual([{ signing_order: 1, role_name: "Customer" }]);
    expect(packet.created_at).toBeTruthy();
    expect(await store.get(`packets/${packet.id}/original.pdf`)).toEqual(pdf);

    const listed = await listPackets(
      new Request("http://sign.test/v1/packets", { headers: { cookie } }),
    );
    expect(listed.status).toBe(200);
    const listJson = (await listed.json()) as { packets: PacketJson[] };
    expect(listJson.packets.some((p) => p.id === packet.id)).toBe(true);
    expect(listJson.packets.find((p) => p.id === packet.id)).toMatchObject({
      title: "Repair packet",
      roles: [{ signing_order: 1, role_name: "Customer" }],
    });

    const got = await getPacket(
      new Request(`http://sign.test/v1/packets/${packet.id}`, {
        headers: { cookie },
      }),
      packetCtx(packet.id),
    );
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({
      id: packet.id,
      title: "Repair packet",
      roles: [{ signing_order: 1, role_name: "Customer" }],
    });
  });

  it("PATCH title and DELETE 204 then GET 404", { timeout: 60_000 }, async () => {
    const { db, store, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const { body } = await packetForm();
    const created = await postPacket(
      new Request("http://sign.test/v1/packets", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    const packet = (await created.json()) as PacketJson;

    const patched = await patchPacket(
      new Request(`http://sign.test/v1/packets/${packet.id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated packet" }),
      }),
      packetCtx(packet.id),
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      id: packet.id,
      title: "Updated packet",
      roles: [{ signing_order: 1, role_name: "Customer" }],
    });

    const del = await deletePacket(
      new Request(`http://sign.test/v1/packets/${packet.id}`, {
        method: "DELETE",
        headers: { cookie },
      }),
      packetCtx(packet.id),
    );
    expect(del.status).toBe(204);

    const got = await getPacket(
      new Request(`http://sign.test/v1/packets/${packet.id}`, {
        headers: { cookie },
      }),
      packetCtx(packet.id),
    );
    expect(got.status).toBe(404);
    const json = (await got.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("not_found");
    expect(await store.get(`packets/${packet.id}/original.pdf`)).toBeNull();
  });

  it("POST envelope_id copies original PDF and defaults roles to signer names", { timeout: 60_000 }, async () => {
    const { db, store, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const minted = await postKeys(
      new Request("http://sign.test/v1/keys", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(minted.status).toBe(201);
    const { key } = (await minted.json()) as { key: string };
    const pdf = await minimalPdf();
    const envBody = new FormData();
    envBody.set("title", "Repair authorization");
    envBody.set("sender_email", "shop@example.com");
    envBody.set(
      "signers",
      JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
    );
    envBody.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const envRes = await postEnvelope(
      new Request("http://sign.test/v1/envelopes", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: envBody,
      }),
    );
    expect(envRes.status).toBe(201);
    const { id: envelopeId } = (await envRes.json()) as { id: string };

    const save = new FormData();
    save.set("envelope_id", envelopeId);
    const created = await postPacket(
      new Request("http://sign.test/v1/packets", {
        method: "POST",
        headers: { cookie },
        body: save,
      }),
    );
    expect(created.status).toBe(201);
    const packet = (await created.json()) as PacketJson;
    expect(packet.title).toBe("Repair authorization");
    expect(packet.roles).toEqual([{ signing_order: 1, role_name: "Jane" }]);
    expect(await store.get(`packets/${packet.id}/original.pdf`)).toEqual(pdf);
  });

  it("POST send creates pending envelope and mails invite", { timeout: 60_000 }, async () => {
    const { db, userFor, sent } = await boot();
    const { cookie } = await asPro(db, userFor);
    const { body } = await packetForm();
    const created = await postPacket(
      new Request("http://sign.test/v1/packets", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    const packet = (await created.json()) as PacketJson;
    const beforeMail = sent.length;

    const sentRes = await sendPacket(
      new Request(`http://sign.test/v1/packets/${packet.id}/send`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          signers: [{ name: "Jane", email: "jane@example.com" }],
        }),
      }),
      packetCtx(packet.id),
    );
    expect(sentRes.status).toBe(201);
    const json = (await sentRes.json()) as {
      id: string;
      status: string;
      signers: { sign_url?: string }[];
    };
    expect(json.status).toBe("pending");
    expect(json.signers).toHaveLength(1);
    expect(json.signers[0]?.sign_url).toMatch(/^\/s\//);
    expect(
      sent.slice(beforeMail).some((m) => /please sign/i.test(m.subject)),
    ).toBe(true);
    expect(sent.slice(beforeMail).some((m) => m.to === "jane@example.com")).toBe(
      true,
    );
  });

  it("send with wrong signer count is 400 invalid_request", { timeout: 60_000 }, async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const { body } = await packetForm();
    const created = await postPacket(
      new Request("http://sign.test/v1/packets", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    const packet = (await created.json()) as PacketJson;
    const res = await sendPacket(
      new Request(`http://sign.test/v1/packets/${packet.id}/send`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          signers: [
            { name: "Jane", email: "jane@example.com" },
            { name: "Bob", email: "bob@example.com" },
          ],
        }),
      }),
      packetCtx(packet.id),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("invalid_request");
  });

  it("51st packet is 400 packet_limit", { timeout: 60_000 }, async () => {
    const { db, userFor } = await boot();
    const { cookie, userId } = await asPro(db, userFor);
    await db.insert(packets).values(
      Array.from({ length: 50 }, (_, i) => ({
        ownerUserId: userId,
        createdByUserId: userId,
        title: `Seed ${i}`,
        storagePath: `packets/seed-${i}/original.pdf`,
      })),
    );
    const { body } = await packetForm();
    const res = await postPacket(
      new Request("http://sign.test/v1/packets", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("packet_limit");
  });

  it("tmp key is 401", async () => {
    await boot();
    const tmp = newTmpKey();
    const res = await listPackets(
      new Request("http://sign.test/v1/packets", {
        headers: { authorization: `Bearer ${tmp.raw}` },
      }),
    );
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("unauthorized");
  });
});
