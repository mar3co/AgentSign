import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { GET as getAuthCallback } from "../../app/auth/callback/route.js";
import { POST as postLogin } from "../../app/login/session/route.js";
import { POST as postDocument } from "../../app/v1/documents/route.js";
import { GET as getDocument } from "../../app/v1/documents/[id]/route.js";
import { POST as postKeys } from "../../app/v1/keys/route.js";
import {
  GET as listTemplates,
  POST as postTemplate,
} from "../../app/v1/templates/route.js";
import {
  DELETE as deleteTemplate,
  GET as getTemplate,
  PATCH as patchTemplate,
} from "../../app/v1/templates/[id]/route.js";
import { POST as sendTemplate } from "../../app/v1/templates/[id]/send/route.js";
import { accounts, oauthGrants, templates } from "../db/schema.js";
import { setDeps } from "../lib/deps.js";
import { createFsStore } from "../lib/storage.js";
import { newOauthToken, newTmpKey } from "../lib/tokens.js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createTestDb } from "./db.js";
import { minimalPdf } from "./pdf.js";

type AuthUser = { id: string; email: string };

type TemplateJson = {
  id: string;
  title: string;
  roles: { signing_order: number; role_name: string }[];
  fields?: { name: string; role: string; type: string }[];
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

async function templateForm(title = "Repair template") {
  const pdf = await minimalPdf();
  const body = new FormData();
  body.set("title", title);
  body.set("roles", JSON.stringify([{ role_name: "Customer" }]));
  body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
  return { body, pdf };
}

function templateCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("templates API", () => {
  it("free session POST template is 403 pro_required", async () => {
    await boot();
    const cookie = await magicCookie("shop@example.com");
    const { body } = await templateForm();
    const res = await postTemplate(
      new Request("http://sign.test/v1/templates", {
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
    const { body, pdf } = await templateForm();
    const created = await postTemplate(
      new Request("http://sign.test/v1/templates", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    expect(created.status).toBe(201);
    const template = (await created.json()) as TemplateJson;
    expect(template.id).toBeTruthy();
    expect(template.title).toBe("Repair template");
    expect(template.roles).toEqual([{ signing_order: 1, role_name: "Customer" }]);
    expect(template.created_at).toBeTruthy();
    expect(await store.get(`templates/${template.id}/original.pdf`)).toEqual(pdf);

    const listed = await listTemplates(
      new Request("http://sign.test/v1/templates", { headers: { cookie } }),
    );
    expect(listed.status).toBe(200);
    const listJson = (await listed.json()) as { templates: TemplateJson[] };
    expect(listJson.templates.some((p) => p.id === template.id)).toBe(true);
    expect(listJson.templates.find((p) => p.id === template.id)).toMatchObject({
      title: "Repair template",
      roles: [{ signing_order: 1, role_name: "Customer" }],
    });

    const got = await getTemplate(
      new Request(`http://sign.test/v1/templates/${template.id}`, {
        headers: { cookie },
      }),
      templateCtx(template.id),
    );
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({
      id: template.id,
      title: "Repair template",
      roles: [{ signing_order: 1, role_name: "Customer" }],
    });
  });

  it("pro POST rejects duplicate role_names", { timeout: 60_000 }, async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const pdf = await minimalPdf();
    const body = new FormData();
    body.set("title", "Repair template");
    body.set(
      "roles",
      JSON.stringify([{ role_name: "Customer" }, { role_name: "Customer" }]),
    );
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const res = await postTemplate(
      new Request("http://sign.test/v1/templates", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("invalid_request");
  });

  it("PATCH title and DELETE 204 then GET 404", { timeout: 60_000 }, async () => {
    const { db, store, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const { body } = await templateForm();
    const created = await postTemplate(
      new Request("http://sign.test/v1/templates", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    const template = (await created.json()) as TemplateJson;

    const patched = await patchTemplate(
      new Request(`http://sign.test/v1/templates/${template.id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "Updated template" }),
      }),
      templateCtx(template.id),
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      id: template.id,
      title: "Updated template",
      roles: [{ signing_order: 1, role_name: "Customer" }],
    });

    const del = await deleteTemplate(
      new Request(`http://sign.test/v1/templates/${template.id}`, {
        method: "DELETE",
        headers: { cookie },
      }),
      templateCtx(template.id),
    );
    expect(del.status).toBe(204);

    const got = await getTemplate(
      new Request(`http://sign.test/v1/templates/${template.id}`, {
        headers: { cookie },
      }),
      templateCtx(template.id),
    );
    expect(got.status).toBe(404);
    const json = (await got.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("not_found");
    expect(await store.get(`templates/${template.id}/original.pdf`)).toBeNull();
  });

  it("POST document_id copies original PDF and defaults roles to signer role names", { timeout: 60_000 }, async () => {
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
    const envRes = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: envBody,
      }),
    );
    expect(envRes.status).toBe(201);
    const { id: documentId } = (await envRes.json()) as { id: string };

    const save = new FormData();
    save.set("document_id", documentId);
    const created = await postTemplate(
      new Request("http://sign.test/v1/templates", {
        method: "POST",
        headers: { cookie },
        body: save,
      }),
    );
    expect(created.status).toBe(201);
    const template = (await created.json()) as TemplateJson;
    expect(template.title).toBe("Repair authorization");
    expect(template.roles).toEqual([{ signing_order: 1, role_name: "Signer 1" }]);
    expect(await store.get(`templates/${template.id}/original.pdf`)).toEqual(pdf);
  });

  it("POST document_id copies tagged fields using signer role names", {
    timeout: 60_000,
  }, async () => {
    const { db, userFor } = await boot();
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
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("{{sig}}", { x: 72, y: 700, size: 12, font });
    const pdf = await doc.save();
    const envBody = new FormData();
    envBody.set("title", "Repair authorization");
    envBody.set("sender_email", "shop@example.com");
    envBody.set(
      "signers",
      JSON.stringify([{ name: "Jane", email: "jane@example.com" }]),
    );
    envBody.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const envRes = await postDocument(
      new Request("http://sign.test/v1/documents", {
        method: "POST",
        headers: { authorization: `Bearer ${key}` },
        body: envBody,
      }),
    );
    expect(envRes.status).toBe(201);
    const { id: documentId } = (await envRes.json()) as { id: string };

    const save = new FormData();
    save.set("document_id", documentId);
    const created = await postTemplate(
      new Request("http://sign.test/v1/templates", {
        method: "POST",
        headers: { cookie },
        body: save,
      }),
    );
    expect(created.status).toBe(201);
    const template = (await created.json()) as TemplateJson;
    expect(template.roles).toEqual([{ signing_order: 1, role_name: "Signer 1" }]);
    expect(template.fields?.some((f) => f.name === "sig" && f.role === "Signer 1")).toBe(
      true,
    );
  });

  it("POST send creates pending document and mails invite", { timeout: 60_000 }, async () => {
    const { db, userFor, sent } = await boot();
    const { cookie } = await asPro(db, userFor);
    const { body } = await templateForm();
    const created = await postTemplate(
      new Request("http://sign.test/v1/templates", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    const template = (await created.json()) as TemplateJson;
    const beforeMail = sent.length;

    const sentRes = await sendTemplate(
      new Request(`http://sign.test/v1/templates/${template.id}/send`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          signers: [{ name: "Jane", email: "jane@example.com" }],
        }),
      }),
      templateCtx(template.id),
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

  it("OAuth agent template send is held for the sender's code", { timeout: 60_000 }, async () => {
    const { db, userFor, sent } = await boot();
    const { cookie, userId } = await asPro(db, userFor);
    const { body } = await templateForm();
    const created = await postTemplate(
      new Request("http://sign.test/v1/templates", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    const template = (await created.json()) as TemplateJson;
    const token = newOauthToken();
    await db.insert(oauthGrants).values({
      userId,
      clientId: "client_test",
      accessHash: token.hash,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const beforeMail = sent.length;

    const sentRes = await sendTemplate(
      new Request(`http://sign.test/v1/templates/${template.id}/send`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.raw}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          signers: [{ name: "Jane", email: "jane@example.com" }],
        }),
      }),
      templateCtx(template.id),
    );
    expect(sentRes.status).toBe(201);
    const json = (await sentRes.json()) as { status: string };
    expect(json.status).toBe("pending_sender");
    const after = sent.slice(beforeMail);
    expect(after.some((m) => /verification code/i.test(m.subject))).toBe(true);
    expect(after.some((m) => m.to === "jane@example.com")).toBe(false);
  });

  it("send with wrong signer count is 400 invalid_request", { timeout: 60_000 }, async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const { body } = await templateForm();
    const created = await postTemplate(
      new Request("http://sign.test/v1/templates", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    const template = (await created.json()) as TemplateJson;
    const res = await sendTemplate(
      new Request(`http://sign.test/v1/templates/${template.id}/send`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          signers: [
            { name: "Jane", email: "jane@example.com" },
            { name: "Bob", email: "bob@example.com" },
          ],
        }),
      }),
      templateCtx(template.id),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("invalid_request");
  });

  it("51st template is 400 template_limit", { timeout: 60_000 }, async () => {
    const { db, userFor } = await boot();
    const { cookie, userId } = await asPro(db, userFor);
    await db.insert(templates).values(
      Array.from({ length: 50 }, (_, i) => ({
        ownerUserId: userId,
        createdByUserId: userId,
        title: `Seed ${i}`,
        storagePath: `templates/seed-${i}/original.pdf`,
      })),
    );
    const { body } = await templateForm();
    const res = await postTemplate(
      new Request("http://sign.test/v1/templates", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("template_limit");
  });

  it("tmp key is 401", async () => {
    await boot();
    const tmp = newTmpKey();
    const res = await listTemplates(
      new Request("http://sign.test/v1/templates", {
        headers: { authorization: `Bearer ${tmp.raw}` },
      }),
    );
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBeTruthy();
    expect(json.code).toBe("unauthorized");
  });

  it("create from tagged PDF stores fields and send copies them", {
    timeout: 60_000,
  }, async () => {
    const { db, userFor } = await boot();
    const { cookie } = await asPro(db, userFor);
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("{{sig;role=Customer}}", { x: 72, y: 700, size: 12, font });
    const pdf = await doc.save();
    const body = new FormData();
    body.set("title", "Repair template");
    body.set("roles", JSON.stringify([{ role_name: "Customer" }]));
    body.set("file", new Blob([pdf], { type: "application/pdf" }), "poa.pdf");
    const created = await postTemplate(
      new Request("http://sign.test/v1/templates", {
        method: "POST",
        headers: { cookie },
        body,
      }),
    );
    expect(created.status).toBe(201);
    const template = (await created.json()) as TemplateJson;
    expect(template.fields?.some((f) => f.name === "sig" && f.role === "Customer")).toBe(
      true,
    );

    const got = await getTemplate(
      new Request(`http://sign.test/v1/templates/${template.id}`, {
        headers: { cookie },
      }),
      templateCtx(template.id),
    );
    expect(got.status).toBe(200);
    const gotJson = (await got.json()) as TemplateJson;
    expect(gotJson.fields?.some((f) => f.name === "sig")).toBe(true);

    const sentRes = await sendTemplate(
      new Request(`http://sign.test/v1/templates/${template.id}/send`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          signers: [{ name: "Jane", email: "jane@example.com" }],
        }),
      }),
      templateCtx(template.id),
    );
    expect(sentRes.status).toBe(201);
    const sentJson = (await sentRes.json()) as { id: string };
    const status = await getDocument(
      new Request(`http://sign.test/v1/documents/${sentJson.id}`, {
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: sentJson.id }) },
    );
    expect(status.status).toBe(200);
    const env = (await status.json()) as { fields: { name: string; role: string }[] };
    expect(env.fields.some((f) => f.name === "sig" && f.role === "Customer")).toBe(true);
  });
});
