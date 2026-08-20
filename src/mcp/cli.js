#!/usr/bin/env -S node --import tsx
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--link-bin")) {
  const destDir = join(process.cwd(), "node_modules", ".bin");
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, "sign-mcp");
  try {
    symlinkSync(fileURLToPath(import.meta.url), dest);
  } catch (err) {
    if (err && err.code !== "EEXIST") throw err;
  }
  process.exit(0);
}

const { runStdio } = await import("./server.ts");
await runStdio();
