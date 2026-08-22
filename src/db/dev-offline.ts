import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { DEV_SCHEMA_SQL } from "./dev-schema.js";
import * as schema from "./schema.js";

export type DevDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Embedded Postgres for DEV_OFFLINE: PGlite with the generated schema applied,
 * persisted under dataDir (in-memory when omitted, as in tests). Queries gate
 * on the one-time schema setup so the first request cannot race it. When the
 * committed schema snapshot changes, the database is rebuilt from scratch:
 * offline dev data is throwaway by design.
 */
export function createDevDb(dataDir?: string): DevDb {
  // PGlite's own mkdir is not recursive.
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir || undefined);
  const hash = createHash("sha256").update(DEV_SCHEMA_SQL).digest("hex");
  const ready = (async () => {
    await client.exec(
      "create table if not exists _dev_meta (schema_hash text primary key)",
    );
    const current = await client.query<{ schema_hash: string }>(
      "select schema_hash from _dev_meta limit 1",
    );
    if (current.rows[0]?.schema_hash === hash) return;
    await client.exec("drop schema public cascade; create schema public;");
    await client.exec(DEV_SCHEMA_SQL);
    await client.exec("create table _dev_meta (schema_hash text primary key)");
    await client.query("insert into _dev_meta (schema_hash) values ($1)", [
      hash,
    ]);
  })();

  const gated = new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (
        typeof value === "function" &&
        (prop === "query" || prop === "exec" || prop === "transaction")
      ) {
        return async (...args: unknown[]) => {
          await ready;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
  return drizzle(gated as PGlite, { schema });
}
