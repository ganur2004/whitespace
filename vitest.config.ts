import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@whitespace/shared": resolve(import.meta.dirname, "shared/src/index.ts"),
    },
  },
  test: {
    include: ["**/test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
  },
});
