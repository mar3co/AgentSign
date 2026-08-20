import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
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
