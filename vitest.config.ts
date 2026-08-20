import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    // Tests import `.js` (NodeNext style); resolve to `.ts` sources.
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
});
