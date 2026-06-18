import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@graphif/project-graph-core": path.resolve(__dirname, "../project-graph-core/src/index.ts"),
      "@graphif/prg-codec": path.resolve(__dirname, "../prg-codec/src/index.ts"),
    },
  },
  test: {
    include: ["packages/project-graph-cli/tests/**/*.test.ts"],
  },
});
