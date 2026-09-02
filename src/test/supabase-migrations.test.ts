import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const schemaTables = Object.values(schema)
  .filter(isTable)
  .map((t) => getTableName(t))
  .sort();

/** A fresh database built only from supabase/migrations, in file order. */
async function freshDbFromMigrations(): Promise<PGlite> {
  const client = new PGlite();
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await client.exec(await readFile(join(MIGRATIONS, file), "utf8"));
  }
  return client;
}

describe("supabase/migrations", () => {
  it("build every table in the drizzle schema from scratch", async () => {
    const client = await freshDbFromMigrations();
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(rows.map((r) => r.tablename)).toEqual(schemaTables);
  });

  it("enable row level security on every table", async () => {
    const client = await freshDbFromMigrations();
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("carry a dedicated RLS migration for databases created before the baseline had it", async () => {
    const files = await readdir(MIGRATIONS);
    const rls = files.find((f) => f.endsWith("_enable_rls.sql"));
    expect(rls).toBeTruthy();
    const sql = await readFile(join(MIGRATIONS, rls!), "utf8");
    for (const table of schemaTables) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE "?${table}"? ENABLE ROW LEVEL SECURITY`));
    }
  });
});
