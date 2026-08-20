import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AuditEvent } from "../db/schema.js";
import * as schema from "../db/schema.js";
import { auditEvents } from "../db/schema.js";

const SECRET_KEYS = new Set([
  "token",
  "raw",
  "sign_url",
  "otp",
  "digits",
  "key",
  "webhook_secret",
]);

export type AuditDb =
  | PostgresJsDatabase<typeof schema>
  | PgliteDatabase<typeof schema>;

export type LogEventInput = {
  envelopeId: string;
  signerId?: string;
  event: AuditEvent;
  ip?: string;
  ua?: string;
  payload?: Record<string, unknown>;
};

function stripSecrets(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (payload == null) return undefined;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!SECRET_KEYS.has(key)) cleaned[key] = value;
  }
  return cleaned;
}

/** Append-only audit insert; strips secret keys from payload. */
export async function logEvent(
  db: AuditDb,
  input: LogEventInput,
): Promise<void> {
  await db.insert(auditEvents).values({
    envelopeId: input.envelopeId,
    signerId: input.signerId,
    event: input.event,
    ip: input.ip,
    ua: input.ua,
    payload: stripSecrets(input.payload),
  });
}
