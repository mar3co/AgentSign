import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // tsconfig uses jsx: preserve for Next; Vitest still needs the automatic runtime.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    // Stray git worktrees under .claude/ carry their own test copies.
    exclude: ["**/node_modules/**", ".claude/**"],
    setupFiles: ["./src/test/setup.ts"],
    // setDeps is process-global; parallel files race the shared DB handle.
    fileParallelism: false,
    // PGlite pushSchema is slow when many files create DBs in parallel.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": root,
    },
    // Tests import `.js` (NodeNext style); resolve to `.ts` sources.
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
});
