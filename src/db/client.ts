import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { devOffline, getEnv } from "../env.js";
import { createDevDb } from "./dev-offline.js";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let db: Db | undefined;

/** Lazy cloud DB from DATABASE_URL. Does not connect at import time. */
export function getDb(): Db {
  if (!db) {
    const { DATABASE_URL } = getEnv();
    if (!DATABASE_URL) {
      if (devOffline()) {
        // Embedded PGlite persisted in the working tree; API-compatible with
        // the postgres-js drizzle instance for everything the routes do.
        db = createDevDb(".dev/pglite") as unknown as Db;
        return db;
      }
      throw new Error("DATABASE_URL is required for getDb()");
    }
    const client = postgres(DATABASE_URL);
    db = drizzle(client, { schema });
  }
  return db;
}
