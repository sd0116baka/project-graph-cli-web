import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app/src"),
      "@graphif/project-graph-core": path.resolve(__dirname, "./packages/project-graph-core/src/index.ts"),
    },
  },
  test: {
    include: ["app/src/**/*.test.{ts,tsx}", "packages/*/tests/**/*.test.{ts,tsx}"],
  },
});
