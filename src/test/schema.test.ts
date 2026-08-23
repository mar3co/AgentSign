import { describe, it, expect } from "vitest";
import { createTestDb } from "./db.js";
import {
  documents,
  accounts,
  templates,
  templateRoles,
  agents,
  signers,
  apiKeys,
  auditEvents,
  oauthClients,
  oauthGrants,
  oauthCodes,
} from "../db/schema.js";
import { newAgentKey } from "../lib/tokens.js";

describe("schema", () => {
  it("inserts a document", async () => {
    const db = await createTestDb();
    const [row] = await db
      .insert(documents)
      .values({
        title: "Repair authorization",
        senderEmail: "shop@example.com",
        status: "pending_sender",
        expiresAt: new Date(Date.now() + 72 * 3600_000),
        shredAt: new Date(Date.now() + 7 * 86400_000),
      })
      .returning();
    expect(row.id).toBeTruthy();
    expect(row.status).toBe("pending_sender");
  });

  it("inserts a template with a role", async () => {
    const db = await createTestDb();
    const userId = crypto.randomUUID();
    await db.insert(accounts).values({ userId, email: "a@b.c", plan: "pro" });
    const [p] = await db.insert(templates).values({
      ownerUserId: userId,
      createdByUserId: userId,
      title: "Repair template",
      storagePath: "templates/x/original.pdf",
    }).returning();
    await db.insert(templateRoles).values({
      templateId: p.id,
      signingOrder: 1,
      roleName: "Customer",
    });
    expect(p.title).toBe("Repair template");
  });

  it("inserts an agent and an agent signer with null tokenHash", async () => {
    const db = await createTestDb();
    const ownerUserId = crypto.randomUUID();
    const [agent] = await db
      .insert(agents)
      .values({
        ownerUserId,
        slug: "grok-legal",
        name: "Grok Legal",
      })
      .returning();
    expect(agent!.id).toBeTruthy();
    expect(agent!.revokedAt).toBeNull();

    const [env] = await db
      .insert(documents)
      .values({
        title: "Agent attest",
        senderEmail: "shop@example.com",
        status: "pending",
        expiresAt: new Date(Date.now() + 72 * 3600_000),
        shredAt: new Date(Date.now() + 7 * 86400_000),
      })
      .returning();

    const [signer] = await db
      .insert(signers)
      .values({
        documentId: env!.id,
        name: "Grok Legal",
        email: "shop@example.com",
        signingOrder: 1,
        kind: "agent",
        agentId: agent!.id,
        tokenHash: null,
      })
      .returning();
    expect(signer!.kind).toBe("agent");
    expect(signer!.tokenHash).toBeNull();
    expect(signer!.tokenEnc).toBeNull();
    expect(newAgentKey().raw.startsWith("sign_agent_")).toBe(true);
  });

  it("uniques agent slug per owner and stores oauth rows", async () => {
    const db = await createTestDb();
    const ownerUserId = crypto.randomUUID();
    await db.insert(agents).values({
      ownerUserId,
      slug: "ops",
      name: "Ops",
    });
    await expect(
      db.insert(agents).values({
        ownerUserId,
        slug: "ops",
        name: "Ops 2",
      }),
    ).rejects.toThrow();
    const [other] = await db
      .insert(agents)
      .values({
        ownerUserId: crypto.randomUUID(),
        slug: "ops",
        name: "Other team",
      })
      .returning();
    expect(other!.slug).toBe("ops");

    const [client] = await db
      .insert(oauthClients)
      .values({
        clientId: "https://example.com/client",
        clientName: "Example",
        redirectUris: ["https://example.com/cb"],
        authMethod: "none",
      })
      .returning();
    const [grant] = await db
      .insert(oauthGrants)
      .values({
        userId: ownerUserId,
        clientId: client!.clientId,
        accessHash: "a".repeat(64),
        refreshHash: "b".repeat(64),
        expiresAt: new Date(Date.now() + 3600_000),
      })
      .returning();
    expect(grant!.allowedAgentIds).toEqual([]);
    await db.insert(oauthCodes).values({
      codeHash: "c".repeat(64),
      userId: ownerUserId,
      clientId: client!.clientId,
      redirectUri: "https://example.com/cb",
      codeChallenge: "challenge",
      resource: "http://localhost:3000/mcp",
      allowedAgentIds: [other!.id],
      expiresAt: new Date(Date.now() + 600_000),
    });

    const key = newAgentKey();
    const [row] = await db
      .insert(apiKeys)
      .values({
        kind: "agent",
        prefix: key.prefix,
        tokenHash: key.hash,
        agentId: other!.id,
        userId: ownerUserId,
        expiresAt: new Date(Date.now() + 365 * 86400_000),
      })
      .returning();
    expect(row!.kind).toBe("agent");

    const [env] = await db
      .insert(documents)
      .values({
        title: "t",
        senderEmail: "a@b.c",
        status: "pending",
        expiresAt: new Date(),
        shredAt: new Date(),
      })
      .returning();
    await db.insert(auditEvents).values([
      { documentId: env!.id, event: "attested" },
      { documentId: env!.id, event: "rejected" },
    ]);
  });
});
