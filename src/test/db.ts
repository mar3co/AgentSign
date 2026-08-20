import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type * as DrizzleKitApi from "drizzle-kit/api";
import * as schema from "../db/schema.js";

// drizzle-kit/api is CJS; createRequire avoids ESM interop issues in Vitest.
const require = createRequire(import.meta.url);
const { pushSchema } = require("drizzle-kit/api") as typeof DrizzleKitApi;

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** In-memory PGlite with schema pushed; no Supabase / auth.users FK. */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const { apply } = await pushSchema(schema, db);
  await apply();
  return db;
}
