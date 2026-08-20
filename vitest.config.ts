import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
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
